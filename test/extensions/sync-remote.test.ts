import { afterEach, describe, expect, test } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { remoteFor, sigV4 } from "../../extensions/shared/sync-remote.ts";
import type { SyncConfig } from "../../extensions/shared/sync-remote.ts";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  delete process.env.TERSIO_GITHUB_API;
});

/** One tiny HTTP host that answers the two wire formats the browser cannot fake. */
async function wireServer(handler: (req: import("node:http").IncomingMessage, body: Buffer) => { status: number; body?: string | Buffer; headers?: Record<string, string> }) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const answer = handler(req, Buffer.concat(chunks));
      res.writeHead(answer.status, { "content-type": "text/plain", ...answer.headers });
      res.end(answer.body ?? "");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

function config(patch: Partial<SyncConfig>): SyncConfig {
  return {
    mode: "webdav",
    webdav: { address: "", user: "", password: "" },
    s3: { endpoint: "", bucket: "", prefix: "", region: "us-east-1", accessKey: "", secret: "", pathStyle: false },
    github: { repository: "", branch: "", folder: "", token: "" },
    ...patch,
  };
}

describe("WebDAV remote", () => {
  test("uploads a sealed file under the Tersio folder, lists it, and reads it back", async () => {
    const files = new Map<string, Buffer>();
    let askedAuth = "";
    const base = await wireServer((req, body) => {
      askedAuth = String(req.headers.authorization ?? "");
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      if (req.method === "PROPFIND") {
        const entries = [...files.keys()].map((name) => `<d:response><d:href>/dav/tersio/${name}</d:href><d:prop><d:getcontentlength>${files.get(name)!.length}</d:getcontentlength><d:getlastmodified>Wed, 04 Nov 2026 14:00:00 GMT</d:getlastmodified></d:prop></d:response>`).join("");
        return { status: 207, body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`, headers: { "content-type": "application/xml" } };
      }
      if (req.method === "MKCOL") return { status: 405 };
      if (req.method === "PUT") {
        files.set(path.split("/").pop() ?? "", body);
        return { status: 201 };
      }
      if (req.method === "GET") {
        const found = files.get(path.split("/").pop() ?? "");
        return found ? { status: 200, body: found } : { status: 404 };
      }
      return { status: 405 };
    });
    const remote = remoteFor(config({ webdav: { address: `${base}/dav`, user: "me", password: "pw" } }));
    await remote.put("data-1.tsb", Buffer.from("sealed"));
    const listed = await remote.list();
    expect(listed.map((entry) => entry.name)).toEqual(["data-1.tsb"]);
    expect(listed[0].bytes).toBe(6);
    expect(listed[0].mtime).toBe(Date.parse("Wed, 04 Nov 2026 14:00:00 GMT"));
    expect((await remote.get("data-1.tsb")).toString()).toBe("sealed");
    expect(askedAuth.startsWith("Basic ")).toBe(true);
  });

  test("a transient 503 is retried instead of failing the listing", async () => {
    let calls = 0;
    const base = await wireServer((req) => {
      if (req.method !== "PROPFIND") return { status: 405 };
      calls += 1;
      if (calls === 1) return { status: 503, body: "busy" };
      return { status: 207, body: '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>', headers: { "content-type": "application/xml" } };
    });
    const remote = remoteFor(config({ webdav: { address: base, user: "", password: "" } }));
    await expect(remote.list()).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  test("an address without http is refused before any request", () => {
    expect(() => remoteFor(config({ webdav: { address: "nas.local/dav", user: "", password: "" } }))).toThrow(/http/);
  });
});

describe("S3 remote", () => {
  test("keeps the endpoint's own base path and uses the bucket as a path segment", async () => {
    const seen: string[] = [];
    const base = await wireServer((req) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.method === "PUT" || req.method === "DELETE") return { status: 200 };
      return { status: 200, body: '<?xml version="1.0"?><ListBucketResult></ListBucketResult>', headers: { "content-type": "application/xml" } };
    });
    const remote = remoteFor(config({
      mode: "s3",
      s3: { endpoint: `${base}/base`, bucket: "backups", prefix: "nightly", region: "us-east-1", accessKey: "key", secret: "secret", sessionToken: "", pathStyle: true },
    }));
    await remote.put("data-1.tsb", Buffer.from("sealed"));
    await remote.list();
    expect(seen).toContain("PUT /base/backups/nightly/tersio/data-1.tsb");
    const listing = seen.find((line) => line.startsWith("GET /base/backups/nightly/tersio/"));
    expect(listing).toBeDefined();
    expect(listing).toContain("list-type=2");
    expect(listing).toContain("prefix=nightly%2Ftersio%2F");
  });

  test("temporary credentials sign with the session token header", () => {
    const headers = sigV4("PUT", new URL("https://b.s3.amazonaws.com/x"), Buffer.from("a"), { region: "us-east-1", accessKey: "k", secret: "s", sessionToken: "token-123" }, {});
    expect(headers["x-amz-security-token"]).toBe("token-123");
    expect(headers.authorization).toContain("x-amz-security-token");
  });
});

describe("GitHub remote", () => {
  test("writes one commit per backup, lists it, and reads the raw file", async () => {
    const files = new Map<string, { body: Buffer; sha: string }>();
    const base = await wireServer((req, body) => {
      const url = new URL(req.url ?? "/", "http://x");
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (req.method === "GET" && req.url?.includes("/contents/tersio")) {
        if (name !== "tersio") {
          const found = files.get(name);
          return found ? { status: 200, body: found.body } : { status: 404 };
        }
        // Deliberately unsorted: the remote decides nothing about order.
        return { status: 200, body: JSON.stringify([{ name: "data-1.tsb", size: 5, type: "file" }, { name: "data-9.tsb", size: 5, type: "file" }]), headers: { "content-type": "application/json" } };
      }
      if (req.method === "PUT") {
        const payload = JSON.parse(body.toString()) as { content: string };
        files.set(name, { body: Buffer.from(payload.content, "base64"), sha: "sha1" });
        return { status: 201, body: "{}", headers: { "content-type": "application/json" } };
      }
      return { status: 404 };
    });
    process.env.TERSIO_GITHUB_API = base;
    const remote = remoteFor(config({ mode: "github", github: { repository: "me/backups", branch: "", folder: "", token: "tok" } }));
    await remote.put("data-2.tsb", Buffer.from("sealed-2"));
    expect([...(await remote.list())].map((entry) => entry.name)).toEqual(["data-9.tsb", "data-1.tsb"]);
    expect((await remote.get("data-2.tsb")).toString()).toBe("sealed-2");
  });

  test("a repository without owner/repo or a token is refused", () => {
    expect(() => remoteFor(config({ mode: "github", github: { repository: "backups", branch: "", folder: "", token: "t" } }))).toThrow(/owner\/repo/);
    expect(() => remoteFor(config({ mode: "github", github: { repository: "me/backups", branch: "", folder: "", token: "" } }))).toThrow(/token/);
  });
});

describe("S3 signing", () => {
  // The AWS SigV4 documentation example (GET examplebucket/test.txt with Range), pinned to its published hex.
  test("reproduces the AWS example signature", () => {
    const headers = sigV4(
      "GET",
      new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      Buffer.alloc(0),
      { region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
      { range: "bytes=0-9" },
      new Date("2013-05-24T00:00:00.000Z"),
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers.authorization).toContain("/20130524/us-east-1/s3/aws4_request");
    expect(headers.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
    expect(headers.authorization.endsWith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")).toBe(true);
  });

  test("a different body or day changes the signature", () => {
    const once = sigV4("PUT", new URL("https://b.s3.amazonaws.com/tersio/a.tsb"), Buffer.from("a"), { region: "us-east-1", accessKey: "k", secret: "s" }, {}, new Date("2026-01-01T00:00:00Z"));
    const twice = sigV4("PUT", new URL("https://b.s3.amazonaws.com/tersio/a.tsb"), Buffer.from("b"), { region: "us-east-1", accessKey: "k", secret: "s" }, {}, new Date("2026-01-01T00:00:00Z"));
    expect(once.authorization).not.toBe(twice.authorization);
  });
});

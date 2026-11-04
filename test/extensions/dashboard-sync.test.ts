import { describe, expect, test } from "vitest";
import { applyTarget, emptyConfig, publicFields } from "../../cli/dashboard-sync.ts";

describe("sync configuration", () => {
  test("a blank secret keeps the saved one, so the panel can save without echoing it", () => {
    const base = { ...emptyConfig(), webdav: { address: "https://dav.example.com", user: "me", password: "saved" } };
    const next = applyTarget("webdav", { address: "https://dav.example.com", user: "me", password: "" }, base);
    expect(next.webdav.password).toBe("saved");
    const replaced = applyTarget("webdav", { address: "https://dav.example.com", user: "me", password: "new" }, base);
    expect(replaced.webdav.password).toBe("new");
  });

  test("only the fields a protocol owns are copied, and they are trimmed", () => {
    const next = applyTarget("s3", {
      endpoint: " https://r2.example.com ",
      bucket: " backups ",
      secret: "s",
      accessKey: "k",
      pathStyle: true,
      repository: "smuggled/repo",
    }, emptyConfig());
    expect(next.mode).toBe("s3");
    expect(next.s3.endpoint).toBe("https://r2.example.com");
    expect(next.s3.bucket).toBe("backups");
    expect(next.s3.region).toBe("us-east-1");
    expect(next.s3.pathStyle).toBe(true);
    // A GitHub field in an S3 request must not overwrite the stored GitHub configuration.
    expect(next.github.repository).toBe("");
  });

  test("the panel never receives a password or a token", () => {
    const config = applyTarget("github", { repository: "me/backups", branch: "main", folder: "", token: "ghp_secret" }, emptyConfig());
    const fields = publicFields(config);
    expect(JSON.stringify(fields)).not.toContain("ghp_secret");
    expect(fields.github).toMatchObject({ repository: "me/backups", branch: "main" });
    const webdav = applyTarget("webdav", { address: "https://x", user: "u", password: "pw" }, config);
    expect(JSON.stringify(publicFields(webdav))).not.toContain("pw");
  });
});

// An RTK binary runs with the user's privileges, so an unverifiable download
// must not be installed. These pin the rule across all three call sites.
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// `cli/common.ts` parses process.argv at import time; loading it through a
// file URL keeps the runner's own args from reaching the flag parser.
const { verifyRtkArchive } = await import(new URL("file:///" + path.join(root, "cli/install.ts").replace(/\\/g, "/")).href);

const ASSET = "rtk-x86_64-apple-darwin.tar.gz";

function fixture(): { archive: string; dir: string; sha: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-verify-"));
  const archive = path.join(dir, ASSET);
  writeFileSync(archive, "archive bytes");
  const sha = createHash("sha256").update("archive bytes").digest("hex");
  return { archive, dir, sha };
}

test("a matching checksum installs", async () => {
  const { archive, dir, sha } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${sha}  ${ASSET}\n`)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a checksum mismatch refuses to install", async () => {
  const { archive, dir } = fixture();
  const wrong = "0".repeat(64);
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${wrong}  ${ASSET}\n`)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The three cases below all previously installed anyway.
test("a missing checksums.txt refuses to install", async () => {
  const { archive, dir } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, null)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checksums.txt without an entry for this asset refuses to install", async () => {
  const { archive, dir, sha } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${sha}  some-other-asset.tar.gz\n`)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty checksums.txt refuses to install", async () => {
  const { archive, dir } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, "")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every `from '../extensions/<base>'` value import in the compiled CLI needs
// its compiled counterpart in the packed tarball (Node runtime), plus the
// .ts source (OMP payload). v2.20.0 shipped .ts only and the installed CLI
// crashed with ERR_MODULE_NOT_FOUND on first run.
function cliExtensionBases(): Set<string> {
  const bases = new Set<string>();
  for (const file of readdirSync(path.join(root, "cli"))) {
    if (!file.endsWith(".ts")) continue;
    for (const line of readFileSync(path.join(root, "cli", file), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("import type ")) continue;
      const match = trimmed.match(/from ["']\.\.\/extensions\/([^"']+)["']/);
      if (match) bases.add(match[1].replace(/\.ts$/, ""));
    }
  }
  return bases;
}

function packedFiles(): Set<string> {
  const which = spawnSync("bun", ["--version"], { encoding: "utf8" });
  expect(which.status, "bun is required to pack (run: bun install)").toBe(0);
  let out: string;
  try {
    out = execFileSync("bun", ["pm", "pack", "--dry-run"], { cwd: root, encoding: "utf8" });
  } catch (e) {
    expect.fail(`bun pm pack --dry-run failed (run bun run build first): ${(e as Error).message}`);
  }
  const files = new Set<string>();
  for (const line of out!.split("\n")) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (match) files.add(match[1].trim());
  }
  return files;
}

test("packed tarball carries both .js (CLI runtime) and .ts (OMP) for every CLI-used extension module", () => {
  const bases = cliExtensionBases();
  expect(bases.size > 0, "expected cli/*.ts to import extension modules").toBe(true);
  const packed = packedFiles();
  for (const base of [...bases].sort()) {
    expect(packed, `missing compiled runtime: extensions/${base}.js`).toContain(`extensions/${base}.js`);
    expect(packed, `missing OMP source: extensions/${base}.ts`).toContain(`extensions/${base}.ts`);
  }
});

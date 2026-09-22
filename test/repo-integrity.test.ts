// test/repo-integrity.test.ts — guards the exact failure behind the red CI
// run on commit 507a832: tracked sources imported
// extensions/shared/usage-store.ts, which was never committed, so every
// fresh checkout (CI, clones) failed at `tsc` with "Cannot find module".
// Disk existence is not enough — the target must be git-tracked, otherwise
// it only exists on the author's machine.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function trackedFiles(): Set<string> {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  expect(result.status, `git ls-files failed: ${result.stderr}`).toBe(0);
  return new Set(
    result.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
  );
}

function stripComments(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function relativeSpecs(body: string): string[] {
  const specs: string[] = [];
  const clean = stripComments(body);
  for (const re of [
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of clean.matchAll(re)) specs.push(match[1]);
  }
  return specs.filter((spec) => spec.startsWith("."));
}

// Compiled .js output is gitignored by design; the tracked source of truth
// is always the .ts file (tests and sources import the same modules as .ts;
// only the compiled CLI keeps requiring ../extensions/* counterparts).
function candidates(source: string, spec: string): string[] {
  const stem = path.posix.join(path.posix.dirname(source), spec).replace(/\.(ts|js)$/, "");
  return [`${stem}.ts`, `${stem}/index.ts`];
}

test("tracked sources only import git-tracked files", () => {
  const tracked = trackedFiles();
  const sources = [...tracked].filter((file) => file.endsWith(".ts")).sort();
  expect(sources.length > 0, "expected tracked .ts sources").toBeTruthy();
  const violations: string[] = [];
  for (const source of sources) {
    const body = readFileSync(path.join(root, source), "utf8");
    for (const spec of new Set(relativeSpecs(body))) {
      if (!candidates(source, spec).some((file) => tracked.has(file))) {
        violations.push(`${source} -> ${spec}`);
      }
    }
  }
  expect(violations, `tracked sources reference files that are not committed — a fresh clone fails at tsc. ` +
      `Commit the targets or fix the imports:\n${violations.join("\n")}`,).toEqual([]);
});

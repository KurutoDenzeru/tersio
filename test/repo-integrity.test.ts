// test/repo-integrity.test.ts — an import target must be git-tracked, not
// merely on disk, or a fresh checkout fails at `tsc`.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

// Compiled .js is gitignored; the tracked source of truth is always the .ts.
function candidates(source: string, spec: string): string[] {
  const stem = path.posix.join(path.posix.dirname(source), spec).replace(/\.(ts|tsx|js|jsx)$/, "");
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`];
}

test("tracked sources only import git-tracked files", () => {
  const tracked = trackedFiles();
  const sources = [...tracked].filter((file) => file.endsWith(".ts") && existsSync(path.join(root, file))).toSorted();
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

// A spawn spreading process.env with an overridden HOME still writes the real
// ~/.pi/agent, which once deleted a real extension tree. cliEnv() pins both.
function gitTsFiles(): string[] {
  return [...trackedFiles()].filter((f) => f.endsWith(".ts"));
}

test("no test spawns the CLI with process.env and an overridden HOME", () => {
  const offenders: string[] = [];
  for (const file of gitTsFiles().filter((f) => f.startsWith("test/") && f !== "test/setup.ts")) {
    for (const [i, line] of readFileSync(path.join(root, file), "utf8").split("\n").entries()) {
      if (!line.includes("...process.env")) continue;
      if (line.includes("HOME") && !line.includes("cliEnv")) offenders.push(`${file}:${i + 1}`);
    }
  }
  expect(offenders, `use cliEnv() from test/helpers/env.ts:\n${offenders.join("\n")}`).toEqual([]);
});

// `opencode plugin add` resolves the server entrypoint through exports["./server"].
test("package exports a loadable opencode server entrypoint", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    exports?: Record<string, string>;
  };
  const entry = pkg.exports?.["./server"];
  expect(entry, 'exports["./server"] must exist for `opencode plugin add`').toBeDefined();
  expect(existsSync(path.join(root, entry as string)), `${entry} must exist in the packed tarball`).toBe(true);
});

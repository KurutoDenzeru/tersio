// An imported module missing from the manifest only fails at host load time.
import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TREE_FILES, sourcePath } from "../../cli/manifest.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  keywords: string[];
  omp: { extensions: string[]; skills: string[] };
  // Optional: pi loads the installed tree by convention, so no manifest is
  // needed. The keywords are what make the package discoverable in the gallery.
  pi?: { extensions?: string[]; skills?: string[] };
};

const entries = [...pkg.omp.extensions, ...(pkg.pi?.extensions ?? [])];

function relativeImports(file: string): string[] {
  const body = readFileSync(path.join(root, file), "utf8");
  const specs: string[] = [];
  for (const re of [
    /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\s*['"](\.[^'"]+)['"]/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const m of body.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

// The transitive closure of relative imports under extensions/.
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry.replace(/^\.\//, "")];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !file.startsWith("extensions/")) continue;
    seen.add(file);
    for (const spec of relativeImports(file)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.(ts|js)$/, ".ts"));
    }
  }
  return [...seen];
}

test("the extension entries in both manifests exist", () => {
  for (const entry of entries) {
    expect(() => readFileSync(path.join(root, entry), "utf8"), entry).not.toThrow();
  }
});

test("every module the extensions import is in the install manifest", () => {
  const installed = new Set(TREE_FILES);
  const missing: string[] = [];
  for (const entry of entries) {
    for (const file of importClosure(entry)) {
      const dest = file.replace(/^extensions\//, "");
      if (!installed.has(dest)) missing.push(`${entry} imports ${file} → ${dest}`);
    }
  }
  expect(missing, `the installed tree would fail to load:\n${missing.join("\n")}`).toEqual([]);
});

test("every manifest entry exists in the source tree", () => {
  for (const file of TREE_FILES) {
    expect(existsSync(sourcePath(file)), file).toBe(true);
  }
});

test("the package keeps the pi keywords, so the gallery can find it", () => {
  expect(pkg.keywords).toContain("pi");
  expect(pkg.keywords).toContain("pi-package");
});

test("the Ponytail skills path every manifest uses is the bundled dependency", () => {
  for (const entry of [...pkg.omp.skills, ...(pkg.pi?.skills ?? [])]) {
    expect(entry, "the skills come from the dependency, not from this repo").toContain("node_modules/@dietrichgebert/ponytail/skills");
  }
});

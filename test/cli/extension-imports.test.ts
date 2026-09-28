// Every module the extensions import must be on the installer's copy list.
// A shared module added and imported but never added to the list installs a
// tree that refuses to load, and the failure only shows up in the host.
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installSource = readFileSync(path.join(root, "cli/install.ts"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  keywords: string[];
  omp: { extensions: string[]; skills: string[] };
  // Optional: pi loads the installed tree by convention, so no manifest is
  // needed. The keywords are what make the package discoverable in the gallery.
  pi?: { extensions?: string[]; skills?: string[] };
};

function constValues(): Map<string, string> {
  const values = new Map<string, string>();
  for (const m of installSource.matchAll(/^const (\w+) = path\.join\(EXT_DIR, ([^)]+)\);/gm)) {
    const segments = [...m[2].matchAll(/'([^']+)'/g)].map((seg) => seg[1]);
    if (segments.length > 0) values.set(m[1], segments.join('/'));
  }
  return values;
}

// Destination paths, relative to the extension dir, that the installer writes.
function copiedTargets(): Set<string> {
  const consts = constValues();
  const targets = new Set<string>();
  // [SOURCE_CONST, path.join('shared', 'host.ts')] — path.join takes any number
  // of literal segments, so collect them all.
  for (const m of installSource.matchAll(/\[(\w+), path\.join\(([^)]+)\)\]/g)) {
    const source = consts.get(m[1]);
    if (!source) continue;
    const segments = [...m[2].matchAll(/'([^']+)'/g)].map((seg) => seg[1]);
    if (segments.length > 0) targets.add(segments.join('/'));
  }
  return targets;
}

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
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.(ts|js)$/, ".ts");
      queue.push(resolved);
    }
  }
  return [...seen];
}

const entries = [...pkg.omp.extensions, ...(pkg.pi?.extensions ?? [])];

test("the extension entries in both manifests exist", () => {
  for (const entry of entries) {
    expect(() => readFileSync(path.join(root, entry), "utf8"), entry).not.toThrow();
  }
});

test("every module the extensions import is on the installer's copy list", () => {
  const copied = copiedTargets();
  const missing: string[] = [];
  for (const entry of entries) {
    for (const file of importClosure(entry)) {
      const dest = file.replace(/^extensions\//, "");
      if (!copied.has(dest)) missing.push(`${entry} imports ${file} → ${dest}`);
    }
  }
  expect(missing, `the installed tree would fail to load:\n${missing.join("\n")}`).toEqual([]);
});

test("the Caveman rule file has a destination beside its extension", () => {
  // Written by stepCaveman with writeIfChanged, not copied by copySources.
  expect(installSource, "stepCaveman writes the rule beside its extension").toContain("path.join(cavemanDir, 'rule.md')");
  expect(installSource).toContain("path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions')");
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

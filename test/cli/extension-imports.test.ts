// The installed extension trees must actually load.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");
const repoExt = path.join(root, "extensions");

// Every `.ts`/`.js` file under a directory, recursively.
function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(abs));
    else if (/\.(ts|js|mjs)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

// Relative import specifiers in a file, without any cache-busting query.
function relativeImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+'(\.[^']+)'|import\('(\.[^']+)'\)/g)]
    .map((m) => (m[1] ?? m[2]).split("?")[0]);
}

function resolves(fromFile: string, spec: string): boolean {
  const target = path.resolve(path.dirname(fromFile), spec);
  return existsSync(target) || existsSync(`${target}.ts`) || existsSync(`${target}.js`);
}

test("every module the extensions import exists in the installed tree", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-imports-"));
  try {
    const result = spawnSync(
      process.execPath,
      [installer, "install", "--yes", "--agent", "omp,pi"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120000,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PATH: path.join(home, "empty-bin"),
          TERSIO_RTK: "off",
        },
      },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);

    const trees = [".omp/agent/extensions", ".pi/agent/extensions"].map((p) => path.join(home, p));
    for (const tree of trees) {
      expect(existsSync(tree), `${tree} was not installed`).toBe(true);
    }

    // 1. Every shared module the extensions import is copied into the tree.
    const piShims = new Set(
      files(path.join(repoExt, "pi", "shared")).map((f) => path.resolve(f)),
    );
    const imported = new Map<string, string>(); // repo module -> first importer
    for (const file of files(repoExt)) {
      if (!file.endsWith(".ts") || piShims.has(path.resolve(file))) continue;
      for (const spec of relativeImports(file)) {
        const target = path.resolve(path.dirname(file), spec);
        const rel = path.relative(repoExt, target);
        if (!/^(shared|lib)\//.test(rel)) continue;
        const real = existsSync(target) ? target : `${target}.ts`;
        expect(existsSync(real), `${path.relative(repoExt, file)} imports ${rel}, which does not exist`).toBe(true);
        if (!imported.has(path.relative(repoExt, real))) {
          imported.set(path.relative(repoExt, real), path.relative(repoExt, file));
        }
      }
    }
    expect(imported.size, "expected the extensions to import shared modules").toBeGreaterThan(0);
    for (const [rel, importer] of imported) {
      for (const tree of trees) {
        expect(
          existsSync(path.join(tree, rel)),
          `${importer} imports ${rel}, but it is not copied into ${tree.replace(home, "~")}, so that extension fails to load`,
        ).toBe(true);
      }
    }

    // 2. Every relative import inside the installed tree resolves.
    const broken: string[] = [];
    let checked = 0;
    for (const tree of trees) {
      for (const file of files(tree)) {
        for (const spec of relativeImports(file)) {
          checked += 1;
          if (!resolves(file, spec)) {
            broken.push(`${path.relative(home, file)} -> ${spec}`);
          }
        }
      }
    }
    expect(checked, "expected the installed trees to import something").toBeGreaterThan(0);
    expect(broken, `unresolvable imports in the installed tree:\n  ${broken.join("\n  ")}`).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);

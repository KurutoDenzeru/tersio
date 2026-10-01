// Fail on unknown Icon names, including dynamic sources lucide may rename.
import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../dashboard/app");
const components = path.join(appDir, "src/components");

// Resolve lucide-react from the dashboard app, not the root package.
const require = createRequire(path.join(appDir, "package.json"));
const { icons } = require("lucide-react") as { icons: Record<string, unknown> };

// Must match Icon.tsx's toPascal: "trash-2" -> "Trash2".
function toPascal(name: string): string {
  return name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

function iconNamesIn(file: string): Array<string> {
  const src = readFileSync(file, "utf8");
  // `s` so a name on its own line still matches; only string literals, so a
  // computed name={foo} is skipped rather than guessed at.
  const direct = [...src.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/gs)].map((m) => m[1]);
  // EmptyState renders an Icon internally, so its icon prop counts too.
  const empty = [...src.matchAll(/<EmptyState\b[^>]*?\bicon="([^"]+)"/gs)].map((m) => m[1]);
  // Dynamic icons reach <Icon name={...}> through icon: "..." pairs.
  const meta = [...src.matchAll(/\bicon:\s*"([^"]+)"/g)].map((m) => m[1]);
  return [...direct, ...empty, ...meta];
}

const libFiles = ["src/lib/format.ts", "src/lib/carbon.ts"].map((f) => path.join(appDir, f));

function zoneGlyphsIn(file: string): Array<string> {
  const src = readFileSync(file, "utf8");
  // Zone helpers return ["glyph", "label", "cls"]; the glyph is the icon name.
  return [...src.matchAll(/return\s*\[\s*"([^"]+)"/g)].map((m) => m[1]);
}

function stripIconsIn(file: string): Array<string> {
  const src = readFileSync(file, "utf8");
  // Token strip rows are ["label", value, "icon-name"].
  return [...src.matchAll(/\[\s*"[^"]+",\s*[^,]+,\s*"([^"]+)"\s*\]/g)].map((m) => m[1]);
}

const files = readdirSync(components)
  .filter((f) => f.endsWith(".tsx") && f !== "Icon.tsx")
  .map((f) => path.join(components, f));

const all = files.flatMap((f) => iconNamesIn(f).map((name) => ({ file: path.basename(f), name })));
const libNames = libFiles.flatMap((f) => zoneGlyphsIn(f).map((name) => ({ file: path.relative(appDir, f), name })));
const stripNames = stripIconsIn(path.join(appDir, "src/components/savings.tsx")).map((name) => ({ file: "savings.tsx(strip)", name }));
const dynamic = [...libNames, ...stripNames];

test("the scan found the icon usages it is meant to guard", () => {
  expect(files.length).toBeGreaterThan(5);
  expect(all.length).toBeGreaterThan(20);
  expect(new Set(all.map((i) => i.name)).size).toBeGreaterThan(10);
});

test("every <Icon name> resolves to a real lucide icon", () => {
  const broken = all
    .filter(({ name }) => !(toPascal(name) in icons))
    .map(({ file, name }) => `${file}: "${name}" -> ${toPascal(name)} not in lucide`);
  expect(broken, broken.join("\n")).toEqual([]);
});

test("dynamic icon sources (zones, carbon, strip) also resolve", () => {
  const broken = dynamic
    .filter(({ name }) => !(toPascal(name) in icons))
    .map(({ file, name }) => `${file}: "${name}" -> ${toPascal(name)} not in lucide`);
  expect(broken, broken.join("\n")).toEqual([]);
});

test("toPascal matches the wrapper's own rule", () => {
  expect(toPascal("trash-2")).toBe("Trash2");
  expect(toPascal("refresh-cw")).toBe("RefreshCw");
  expect(toPascal("x")).toBe("X");
  // The rename that started this: Trash2 is gone in this lucide, Trash is not.
  expect(toPascal("trash-2") in icons).toBe(false);
  expect("Trash" in icons).toBe(true);
});

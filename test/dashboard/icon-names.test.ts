// The Icon wrapper falls back to Sparkles when a name does not resolve, which
// turns a lucide rename into a silently wrong glyph rather than an error. This
// walks every <Icon name="..."> in the app and asserts it still exists.
import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../dashboard/app");
const components = path.join(appDir, "src/components");

// lucide-react belongs to the dashboard app, not the root package, so resolve it
// from that package instead of importing it by bare name. The CJS build is used
// because require() works on every supported Node, and the test only reads data.
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
  return [...src.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/gs)].map((m) => m[1]);
}

const files = readdirSync(components)
  .filter((f) => f.endsWith(".tsx") && f !== "Icon.tsx")
  .map((f) => path.join(components, f));

const all = files.flatMap((f) => iconNamesIn(f).map((name) => ({ file: path.basename(f), name })));

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

test("toPascal matches the wrapper's own rule", () => {
  expect(toPascal("trash-2")).toBe("Trash2");
  expect(toPascal("refresh-cw")).toBe("RefreshCw");
  expect(toPascal("x")).toBe("X");
  // The rename that started this: Trash2 is gone in this lucide, Trash is not.
  expect(toPascal("trash-2") in icons).toBe(false);
  expect("Trash" in icons).toBe(true);
});

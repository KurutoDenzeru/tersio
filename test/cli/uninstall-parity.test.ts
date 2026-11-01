// An install writes every extension dir the package ships; a removal that misses one leaves that extension importing a shared file the same removal deleted, and the agent refuses to start.
import { expect, test } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PI_TREE_DIRS, SHIPPED_TREE_DIRS } from "../../cli/uninstall.ts";

const extensionsDir = fileURLToPath(new URL("../../extensions", import.meta.url));

test("every shipped extension dir has a removal entry, on both hosts", () => {
  const shipped = readdirSync(extensionsDir).filter((name) => statSync(path.join(extensionsDir, name)).isDirectory());
  // ponytail rides along as its own package, never as an extensions/<dir> tree; it has its own removal.
  // dsh is a dsh-bundle payload for the DeepSeek Harness host, not a per-host tree: uninstall --host dsh removes the bundle from DeepSeek Harness itself.
  const trees = shipped.filter((name) => name !== "ponytail" && name !== "dsh");
  expect(trees.length).toBeGreaterThan(5);
  for (const tree of trees) {
    expect(SHIPPED_TREE_DIRS as readonly string[], `${tree} would outlive an uninstall`).toContain(tree);
    expect(PI_TREE_DIRS, `${tree} would outlive a pi uninstall`).toContain(tree);
  }
});

test("the pi removal covers the tree root file an install writes", () => {
  // pi discovers <ext>/server.ts beside the extension dirs; removing the dirs but not the file leaves a module whose imports are gone.
  expect(PI_TREE_DIRS).toContain("server.ts");
});
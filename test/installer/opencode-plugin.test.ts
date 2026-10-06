import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { cliEnv } from "../helpers/env.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const installer = path.join(root, "dist", "tersio.js");

function home(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-plugin-"));
  const cfg = path.join(dir, ".config", "opencode");
  mkdirSync(cfg, { recursive: true });
  writeFileSync(path.join(cfg, "opencode.json"), JSON.stringify({
    plugins: ["/Users/me/.config/opencode/plugins/rtk.ts", "/Users/me/.config/opencode/plugins/herdr.js"],
  }, null, 2));
  return dir;
}

function run(dir: string, args: string[]): string {
  return execFileSync(process.execPath, [installer, ...args], {
    cwd: root, encoding: "utf8", timeout: 120000,
    env: cliEnv(dir, { PI_OFFLINE: "1" }),
  });
}

test("opencode install registers one plugin and drops the rtk entry", () => {
  const dir = home();
  try {
    const out = run(dir, ["install", "--host", "opencode", "--yes"]);
    const config = JSON.parse(readFileSync(path.join(dir, ".config", "opencode", "opencode.json"), "utf8")) as { plugins: string[] };
    expect(config.plugins).toEqual([expect.stringContaining("/opencode/plugins/herdr.js"), expect.stringContaining("/opencode/plugins/tersio")]);
    expect(existsSync(path.join(dir, ".config", "opencode", "plugins", "rtk.ts"))).toBe(false);
    expect(out).toMatch(/no separate entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 150000);

test("doctor --fix also drops a leftover rtk plugin entry", () => {
  const dir = home();
  try {
    const plugins = path.join(dir, ".config", "opencode", "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(path.join(plugins, "rtk.ts"), "// stale rtk plugin\n", "utf8");
    const nested = path.join(plugins, "tersio", "opencode");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "server.ts"), "export default {}\n", "utf8");
    run(dir, ["doctor", "--fix", "extensions", "--yes"]);
    expect(existsSync(path.join(plugins, "rtk.ts"))).toBe(false);
    const config = JSON.parse(readFileSync(path.join(dir, ".config", "opencode", "opencode.json"), "utf8")) as { plugins: string[] };
    expect(config.plugins.some((p) => p.endsWith("/plugins/rtk"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 150000);
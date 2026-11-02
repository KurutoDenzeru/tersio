import { expect, test, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cliEnv } from "../helpers/env.ts";
import { registryUrl, releasesUrl } from "../helpers/registry.ts";
import { installerManager } from "../../cli/update.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Keep updater tests offline and deterministic: report the bundled copy as latest.
vi.mock("../../extensions/shared/utils.ts", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchJson: async (url: string) => {
      if (String(url).includes("ponytail")) {
        const bundled = JSON.parse(readFileSync(path.join(root, "extensions", "ponytail", "package.json"), "utf8")) as { version?: string };
        return { version: bundled.version, dist: { tarball: "", shasum: "" } };
      }
      return (original.fetchJson as (u: string) => Promise<unknown>)(url);
    },
  };
});
const updaterPath = path.join(root, "extensions", "shared", "updater.ts");
const updaterUrl = new URL("file:///" + updaterPath.replace(/\\/g, "/"));

const { parseChecksum, runAddonUpdate } = await import(updaterUrl.href);

const HOME = os.homedir();
const PLUGINS_DIR = path.join(HOME, ".omp", "plugins");

type ExecMock = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string; code: number }>;

interface FakeCtx {
  cwd: string;
  ui: { notify(message: string): void };
}

const createFakeCtx = (): FakeCtx & { shown: string[] } => {
  const shown: string[] = [];
  return { cwd: PLUGINS_DIR, ui: { notify: (msg: string) => { shown.push(String(msg)); } }, shown };
};

test("parseChecksum returns lowercase 64-char hash for standard line with optional * and nested filename", () => {
  const checksums = `
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  *ponytail-1.2.3.tgz
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz
`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum accepts a checksum line without a star", () => {
  const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum matches a nested filename by basename", () => {
  const checksums = `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum normalizes uppercase hash to lowercase", () => {
  const checksums = `DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum returns null for malformed content and different asset", () => {
  const malformed = "not a valid checksum line\n";
  expect(parseChecksum(malformed, "ponytail-1.2.3.tgz")).toBe(null);

  const mismatched = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  other-package-1.0.0.tgz\n";
  expect(parseChecksum(mismatched, "ponytail-1.2.3.tgz")).toBe(null);
});

/** A registry that cannot answer, so the target falls back to `@latest` with nothing on the wire. */
const deadRegistry = { TERSIO_UPDATE_URL: "http://127.0.0.1:1/latest" };
/** A release feed that cannot answer, so the registry alone decides the version. */
const deadReleases = { TERSIO_RELEASES_URL: "http://127.0.0.1:1/releases/latest" };

test("a ponytail update reports the bundled copy without touching npm", async () => {
  const execCalls: { cmd: string; args: string[]; opts: { cwd: string } }[] = [];
  const execMock: ExecMock = async (cmd, args, opts) => {
    execCalls.push({ cmd, args, opts });
    return { stdout: "updated", stderr: "", code: 0 };
  };

  const fakeCtx = createFakeCtx();
  await runAddonUpdate({ exec: execMock }, fakeCtx, "ponytail");

  expect(execCalls.length, "bundled ponytail must not shell out to npm").toBe(0);
  const shown = fakeCtx.shown.join("\n");
  expect(shown).toMatch(/up to date|cannot fetch npm metadata/i);
  expect(shown).not.toMatch(/Ponytail update failed: tar could not/);
});
test("a ponytail update without host exec still avoids npm", async () => {
  const fakeCtx = createFakeCtx();
  await runAddonUpdate({}, fakeCtx, "ponytail");
  expect(fakeCtx.shown.join("\n")).toMatch(/up to date|cannot fetch npm metadata/i);
});

// A file:// URL, not a path: `import()` of `D:/...` reports protocol 'd:' on Windows.
const updateJs = pathToFileURL(path.join(root, "dist", "cli", "update.js")).href;

// State lives in the ledger now, so the probe asks the module instead of a file.
const stateJs = pathToFileURL(path.join(root, "dist", "extensions", "shared", "state.js")).href;
const PROBE = "import('" + updateJs + "').then(async (m) => {"
  + " const out = { cached: await m.checkForUpdate(), forced: await m.checkForUpdate(true) };"
  + " const state = await import('" + stateJs + "');"
  + " out.state = state.readState();"
  + " console.log('TERSIO-PROBE:' + JSON.stringify(out));"
  + "}).catch((e) => { console.error('PROBE-FAIL:' + e.message); process.exit(1); });";

type Env = Record<string, string | undefined>;

function setup(feedUrl: string, cache: unknown, releases = deadReleases.TERSIO_RELEASES_URL): { dir: string; env: Env } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-update-check-"));
  const home = path.join(dir, "home");
  mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
  if (cache !== null) {
    writeFileSync(path.join(home, ".omp", "plugins", "tersio-update-check.json"), JSON.stringify(cache), "utf8");
  }
  const env: Env = cliEnv(home, { TERSIO_UPDATE_URL: feedUrl, TERSIO_RELEASES_URL: releases });
  return { dir, env };
}

function probe(env: Env): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["-e", PROBE], { encoding: "utf8", env });
  expect(result.status, result.stderr).toBe(0);
  const line = result.stdout.split("\n").find((l) => l.startsWith("TERSIO-PROBE:"));
  expect(line, result.stdout + result.stderr).toBeTruthy();
  return JSON.parse((line as string).slice("TERSIO-PROBE:".length));
}

test("explicit check bypasses a fresh stale cache", () => {
  const { dir, env } = setup(registryUrl("9.9.9"), { latest: "2.8.0", lastCheck: Date.now() });
  try {
    const out = probe(env);
    expect(out.cached).toBe(null);
    expect(out.forced).toBe("9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unreachable registry reports unknown, never latest", () => {
  const { dir, env } = setup(deadRegistry.TERSIO_UPDATE_URL, null);
  try {
    const out = probe(env);
    expect(out.cached).toBe("unknown");
    expect(out.forced).toBe("unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The source and the registry tag the probe's state recorded, read through a guard. */
function probeSources(out: Record<string, unknown>): { source: string | null; npm: string | null } {
  const state = out.state;
  const check = state && typeof state === "object" && "updateCheck" in state ? state.updateCheck : null;
  if (!check || typeof check !== "object") return { source: null, npm: null };
  const source = "source" in check && typeof check.source === "string" ? check.source : null;
  const npm = "npm" in check && typeof check.npm === "string" ? check.npm : null;
  return { source, npm };
}

test("the release feed wins when it names a newer version than the registry", () => {
  const { dir, env } = setup(registryUrl("2.8.0"), null, releasesUrl("9.9.9"));
  try {
    const out = probe(env);
    expect(out.forced).toBe("9.9.9");
    expect(probeSources(out)).toEqual({ source: "github", npm: "2.8.0" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the registry wins when it names the newer version", () => {
  const { dir, env } = setup(registryUrl("9.9.9"), null, releasesUrl("2.8.0"));
  try {
    const out = probe(env);
    expect(out.forced).toBe("9.9.9");
    expect(probeSources(out)).toEqual({ source: "npm", npm: "9.9.9" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the release feed answers when the registry does not", () => {
  const { dir, env } = setup(deadRegistry.TERSIO_UPDATE_URL, null, releasesUrl("9.9.9"));
  try {
    const out = probe(env);
    expect(out.forced).toBe("9.9.9");
    expect(probeSources(out)).toEqual({ source: "github", npm: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const installer = path.join(root, "dist", "tersio.js");

// `tersio update` refreshes the price cache; a dead port and temp file keep it off the spawn timeout.
const deadPricesEnv = (): Record<string, string> => ({
  TERSIO_PRICES_URL: "http://127.0.0.1:1/prices.json",
  TERSIO_PRICES_FILE: path.join(mkdtempSync(path.join(os.tmpdir(), "tersio-update-prices-")), "prices.json"),
});

test("update refreshes the globally installed CLI before delegating", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-global-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--host", "pi"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ...deadPricesEnv(),
          // A newer release is what makes the plan stale, which is what this test is about.
          TERSIO_UPDATE_URL: registryUrl("99.0.0"),
          ...deadReleases,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Checking for updates:/);
    expect(result.stdout).toMatch(/fake-npm exec --yes --prefer-online --package=@krtclcdy\/tersio@99\.0\.0/);
    expect(result.stdout).toMatch(/Done — tersio .* and add-ons updated\./);
    expect(result.stdout).not.toMatch(/Restart OMP/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("update dry-run previews the global CLI refresh without running npm -g", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-dryrun-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run", "--host", "pi"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ...deadRegistry,
          ...deadReleases,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Tersio: /);
    expect(result.stdout).toMatch(/\[dry-run\] would run: npm install -g @krtclcdy\/tersio@latest/);
    expect(result.stdout).not.toMatch(/fake-npm install -g/);
    expect(result.stdout).toMatch(/\[dry-run\] would delegate: npm exec --yes --prefer-online --package=@krtclcdy\/tersio@latest/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

// A bun global install lives at ~/.bun/install/global; refreshing only the npm copy leaves the old CLI on PATH, and the next run offers the same update again.
test("update refreshes the manager that installed this copy", () => {
  // A temp home, with the installed copy really on disk: CI has no ~/.bun, and a dangling symlink made realpath fail there while a developer machine's real install made the same test pass.
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-manager-"));
  try {
    const bunSelf = path.join(home, ".bun", "install", "global", "node_modules", "@krtclcdy", "tersio", "dist", "tersio.js");
    const npmSelf = path.join(home, ".nvm", "versions", "node", "v20", "lib", "node_modules", "@krtclcdy", "tersio", "dist", "tersio.js");
    mkdirSync(path.dirname(bunSelf), { recursive: true });
    writeFileSync(bunSelf, "// installed copy\n");

    const bun = installerManager(bunSelf, home);
    expect(bun.label, "a copy under ~/.bun refreshes through bun").toBe("bun");
    expect(bun.args("@2.0.0")).toContain("@krtclcdy/tersio@2.0.0");

    const npm = installerManager(npmSelf, home);
    expect(npm.label, "a copy anywhere else refreshes through npm").toBe("npm");

    // The bin is a symlink into the global tree, and that is the path the process sees.
    const link = path.join(home, ".bun", "bin", "tersio");
    mkdirSync(path.dirname(link), { recursive: true });
    try {
      symlinkSync(bunSelf, link);
    } catch (e) {
      // A Windows runner may not grant the symlink privilege; the path check above still covers the rule.
      if ((e as NodeJS.ErrnoException).code === "EPERM") return;
      throw e;
    }
    expect(installerManager(link, home).label, "a symlinked bin resolves to its install").toBe("bun");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("update installs the CLI and leaves the agents alone", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-test-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ...deadRegistry,
          ...deadReleases,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would run: npm install -g @krtclcdy\/tersio/);
    expect(result.stdout).not.toMatch(/--apply-update/);
    expect(result.stdout, "the hint names the opt-in").toMatch(/tersio update --host <agent>/);
    expect(result.stdout).not.toMatch(/fake-npm exec/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("update aborts before the global install when the payload fails its smoke check", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-smoke-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-update-smoke-home-"));

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, '@echo off\r\necho %* | findstr /C:"--version" >nul\r\nif not errorlevel 1 (echo ERR_MODULE_NOT_FOUND 1>&2 & exit /b 1)\r\necho fake-npm %*\r\n', "utf8");
    } else {
      writeFileSync(
        npm,
        '#!/bin/sh\nfor a in "$@"; do if [ "$a" = "--version" ]; then echo "ERR_MODULE_NOT_FOUND" >&2; exit 1; fi; done; printf \'fake-npm %s\\n\' "$*"\n',
        "utf8"
      );
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--host", "omp"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ...deadPricesEnv(),
          TERSIO_UPDATE_URL: registryUrl("9.9.9"),
          ...deadReleases,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
          HOME: home,
        },
        timeout: 15000,
      }
    );

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/failed its smoke check/);
    expect(result.stdout).not.toMatch(/fake-npm install -g/);
    expect(result.stdout).not.toMatch(/fake-npm exec/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("update pins the resolved version instead of trusting @latest", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-pin-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-update-pin-home-"));

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, '@echo off\r\necho fake-npm %*\r\n', "utf8");
    } else {
      writeFileSync(npm, '#!/bin/sh\nprintf \'fake-npm %s\\n\' "$*"\n', "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TERSIO_UPDATE_URL: registryUrl("9.9.9"),
          ...deadReleases,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
          HOME: home,
        },
        timeout: 15000,
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Tersio: .* → 9\.9\.9/);
    expect(result.stdout).toMatch(/\[dry-run\] would run: npm install -g @krtclcdy\/tersio@9\.9\.9/);
    expect(result.stdout).toMatch(/would run: npm install -g @krtclcdy\/tersio@9\.9\.9/);
    expect(result.stdout).not.toMatch(/@latest/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// `tersio update` used to default to OMP and never ask, while the help said a terminal asks. Piped stdin is a script: no prompt, and no --host, so the child keeps its own default.
test("a piped update asks nothing and forwards no host", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "tersio-update-nohost-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");
  try {
    if (process.platform === "win32") writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }
    const result = spawnSync(process.execPath, [installer, "update", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...deadRegistry, ...deadReleases, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
      timeout: 15000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Update which agent\?/);
    expect(result.stdout).not.toMatch(/--apply-update/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("--host still pins the agent, and no prompt appears when stdin is a pipe", () => {
  const result = spawnSync(process.execPath, [installer, "update", "--dry-run", "--host", "pi"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...deadRegistry, ...deadReleases },
    timeout: 15000,
  });

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(/Update which agent\?/);
  expect(result.stdout).toMatch(/--host pi/);
});

// The delegated command repeats `--host`, and the inner run used to read the host as its command.
test("the delegated form parses --host instead of taking it for a command", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-update-host-"));
  try {
    const result = spawnSync(process.execPath, [installer, "--apply-update", "--dry-run", "--yes", "--host", "pi"], {
      cwd: root,
      encoding: "utf8",
      env: cliEnv(home),
      timeout: 15000,
    });

    expect(result.stderr).not.toMatch(/Unknown command/);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
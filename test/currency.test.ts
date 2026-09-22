import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { convertUsd, formatCurrency } from "../cli/currency.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tersio.js");

test("formatCurrency defaults to USD with magnitude-aware decimals", () => {
  assert.equal(formatCurrency(1.5, "USD"), "$1.50");
  assert.equal(formatCurrency(0.000187, "USD"), "$0.000187");
  assert.equal(formatCurrency(0, "USD"), "$0.00");
});

test("formatCurrency converts through the snapshot rates", () => {
  assert.equal(convertUsd(1, "PHP"), 58.7);
  assert.equal(formatCurrency(1, "PHP"), "₱58.70");
  assert.equal(formatCurrency(1, "JPY"), "¥150");
  assert.equal(formatCurrency(2, "EUR"), "€1.84");
});

function fixtureSessions(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    [
      '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-01T10:00:00.000Z","cwd":"/tmp"}',
      '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":0,"cost":0.012},"content":[]}}',
    ].join("\n") + "\n",
    "utf8",
  );
  return dir;
}

function usageEnv(dir: string, sessions: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
    TERSIO_USAGE_FILE: path.join(dir, "usage.jsonl"),
    TERSIO_SESSIONS_DIR: sessions,
    TERSIO_RESET_FILE: path.join(dir, "reset.json"),
    TERSIO_USAGE_DB: path.join(dir, "usage.db"),
    TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
  };
}

function writeSettingsLock(home: string, tersio: Record<string, unknown>): void {
  const dir = path.join(home, ".omp", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "omp-plugins.lock.json"),
    JSON.stringify({ plugins: {}, settings: { "@krtclcdy/tersio": tersio } }),
    "utf8",
  );
}

test("usage defaults to USD and converts with --currency", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-"));
  const sessions = fixtureSessions();
  try {
    const usd = spawnSync(process.execPath, [installer, "usage"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(usd.status, 0, usd.stderr);
    assert.match(usd.stdout, /\$0\.0041/);
    assert.match(usd.stdout, /USD │/);

    const php = spawnSync(process.execPath, [installer, "usage", "--currency", "php"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(php.status, 0, php.stderr);
    assert.match(php.stdout, /₱0\.24/);
    assert.match(php.stdout, /PHP │/);
    assert.doesNotMatch(php.stdout, /\$0\.0041/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("usage prefers the stored currency default, flag overrides it", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-stored-"));
  const sessions = fixtureSessions();
  writeSettingsLock(dir, { currency: "PHP" });
  try {
    const stored = spawnSync(process.execPath, [installer, "usage"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(stored.status, 0, stored.stderr);
    assert.match(stored.stdout, /₱0\.24/, "stored PHP default applies without a flag");

    const flag = spawnSync(process.execPath, [installer, "usage", "--currency", "EUR"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(flag.status, 0, flag.stderr);
    assert.match(flag.stdout, /€0\.0038/, "explicit flag beats the stored default");
    assert.doesNotMatch(flag.stdout, /₱0\.24/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("usage falls back to USD on a corrupt or unknown stored currency", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-bad-"));
  const sessions = fixtureSessions();
  try {
    writeSettingsLock(dir, { currency: "bogus" });
    const bad = spawnSync(process.execPath, [installer, "usage"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(bad.status, 0, bad.stderr);
    assert.match(bad.stdout, /\$0\.0041/);

    writeFileSync(
      path.join(dir, ".omp", "plugins", "omp-plugins.lock.json"),
      "{ not json",
      "utf8",
    );
    const corrupt = spawnSync(process.execPath, [installer, "usage"], {
      encoding: "utf8",
      cwd: root,
      env: usageEnv(dir, sessions),
    });
    assert.equal(corrupt.status, 0, corrupt.stderr);
    assert.match(corrupt.stdout, /\$0\.0041/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test("usage rejects an unknown --currency", () => {
  const result = spawnSync(process.execPath, [installer, "usage", "--currency", "bogus"], {
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --currency/);
});

test("gain --export bakes the requested currency into data.json", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-gain-"));
  const out = path.join(dir, "dash.html");
  try {
    const result = spawnSync(process.execPath, [installer, "gain", "--export", out, "--currency", "PHP"], {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        TERSIO_USAGE_FILE: path.join(dir, "usage.jsonl"),
        TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
        TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
        TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
        TERSIO_RESET_FILE: path.join(dir, "reset.json"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const body = readFileSync(out, "utf8");
    assert.match(body, /"currency":"PHP"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

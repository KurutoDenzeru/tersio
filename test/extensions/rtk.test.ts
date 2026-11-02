// Zero coverage once shipped a crashing tool call; keep it covered. Every failure path must keep the original output: a wrong filtered result is worse.
import { expect, test } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The filter spawns a shell for the `<` redirect, and Windows has no /bin/sh.
const SHELL_INFO = filterShell();

import rtkFilterExtension, {
  FILTER_BY_TOOL,
  MIN_FILTER_BYTES,
  filterShell,
  filterThroughRtk,
  filterableText,
  rtkActive,
} from "../../extensions/rtk/filter.ts";
import type { FilterExec } from "../../extensions/rtk/filter.ts";
import rtkSessionExtension from "../../extensions/rtk/session.ts";
import timingExtension from "../../extensions/timing/index.ts";
import { resetSharedComboState, setSharedComboMode } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry, ToolResultEvent } from "../../extensions/shared/types.ts";
import { readRtkGain, readRtkGainByVerb, rtkDbPath, rtkGainFailure } from "../../extensions/shared/rtk-gain.ts";
import { wireRtk } from "../../cli/rtk-wiring.ts";
import { findFile, resolveRtkBinary, rtkPlatformSpec, shimCommand } from "../../extensions/shared/utils.ts";
import { sqliteExec } from "../../extensions/shared/sqlite.ts";
import { fakeRtkBin, hasSqlite, withHome as inHome } from "../helpers/env.ts";

// fileURLToPath, not `.pathname`: a URL pathname on Windows is `/D:/...`, which path.join doubles into `D:\D:\...`.
process.env.HOME = fileURLToPath(new URL("../definitely-missing-home/rtk", import.meta.url));
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

// ===== rtk-filter.test.ts =====

/** A `rtk` file on PATH, so `resolveRtkBinary` finds a binary the stub exec never spawns. */
function withFakeRtk(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "tersio-rtk-bin-"));
  fakeRtkBin(dir);
  const previous = process.env.PATH;
  process.env.PATH = dir;
  return work(dir).finally(() => {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

function big(marker = "match"): string {
  const line = `src/file.ts:12:${marker} a line of grep output that the filter should drop\n`;
  return line.repeat(Math.ceil(MIN_FILTER_BYTES / line.length) + 5);
}

type Entries = SessionEntry[];
type Handler = (event: ToolResultEvent, ctx: ExtensionCtx) => Promise<unknown>;

function harness(exec: FilterExec | undefined, entries: Entries = []) {
  const handlers = new Map<string, Handler>();
  const api: Record<string, unknown> = {
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, handler: Handler) { handlers.set(event, handler); },
    cwd: "/tmp",
  };
  if (exec) api.exec = exec;
  rtkFilterExtension(api as unknown as ExtensionApi);
  const ctx = { hasUI: false, sessionManager: { getBranch: () => entries } } as ExtensionCtx;
  const has = (name: string): boolean => handlers.has(name);
  return {
    fire: (event: ToolResultEvent) => handlers.get("tool_result")!(event, ctx),
    call: (event: { toolName?: string; input?: { command?: string } }) => handlers.get("tool_call")!(event, ctx),
    has,
  };
}

const grepEvent = (text: string): ToolResultEvent => ({ toolName: "grep", content: [{ type: "text", text }] });

// Registered synchronously, so the first call of a fast session is covered: the rtk-init hook awaits a version probe first.
test("a bash command is rewritten through rtk before it runs", async () => {
  await withFakeRtk(async () => {
    const seen: string[][] = [];
    const h = harness(async (_cmd, args) => { seen.push(args); return { stdout: "rtk git status", stderr: "", code: 0 }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const event = { toolName: "bash", input: { command: "git status" } };
    await h.call(event);
    expect(event.input.command).toBe("rtk git status");
    expect(seen).toEqual([["rewrite", "git status"]]);
  });
});

test("a command rtk leaves alone, and a mode-off session, keep the original", async () => {
  await withFakeRtk(async () => {
    const off = harness(async () => ({ stdout: "", stderr: "", code: 1 }), []);
    const offEvent = { toolName: "bash", input: { command: "git status" } };
    await off.call(offEvent);
    expect(offEvent.input.command).toBe("git status");

    const on = harness(async () => ({ stdout: "", stderr: "", code: 1 }),
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const onEvent = { toolName: "bash", input: { command: "journalctl -u nginx" } };
    await on.call(onEvent);
    expect(onEvent.input.command).toBe("journalctl -u nginx");

    // An already-rewritten command must not gain a second prefix.
    const twice = { toolName: "bash", input: { command: "rtk git status" } };
    await on.call(twice);
    expect(twice.input.command).toBe("rtk git status");
  });
});

test("a grep result over the threshold is replaced by the rtk filter", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    const calls: Array<{ cmd: string; args: string[]; timeout?: number }> = [];
    const h = harness(async (cmd, args, opts) => {
      calls.push({ cmd, args, timeout: opts?.timeout });
      return { stdout: "3 matches in 1F:\n  src/file.ts (3)\n", code: 0 };
    }, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    const result = await h.fire(grepEvent(big())) as { content: Array<{ type: string; text: string }> };

    expect(result.content).toEqual([{ type: "text", text: "3 matches in 1F:\n  src/file.ts (3)\n" }]);
    // Windows has no /bin/sh, so the filter spawns cmd.exe there instead.
    expect(calls[0].cmd, "an absolute shell, so a minimal PATH cannot break the spawn")
      .toBe(SHELL_INFO.shell);
    expect(calls[0].args.slice(0, SHELL_INFO.flags.length)).toEqual(SHELL_INFO.flags);
    expect(calls[0].args[SHELL_INFO.flags.length]).toMatch(/pipe -f grep/);
    expect(calls[0].args.at(-1)).toMatch(/< "/);
    // A hung filter must not stall the tool result.
    expect(calls[0].timeout).toBe(5000);
    // The payload file is removed, so the gathered text does not pile up in /tmp.
    const command = calls[0].args[SHELL_INFO.flags.length];
    const redirected = command.match(/< "([^"]+)"/);
    expect(redirected, "the filter reads the payload from a file").not.toBeNull();
    expect(existsSync(redirected![1])).toBe(false);
  });
});

test("glob is filtered as find, and read is never filtered", async () => {
  expect(FILTER_BY_TOOL.get("glob")).toBe("find");
  expect(FILTER_BY_TOOL.get("grep")).toBe("grep");
  expect(FILTER_BY_TOOL.get("read"), "a filtered read would not match the file being edited").toBeUndefined();

  await withFakeRtk(async () => {
    resetSharedComboState();
    let called = 0;
    const exec: FilterExec = async () => { called += 1; return { stdout: "small", code: 0 }; };
    const h = harness(exec, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    const globbed = await h.fire({ toolName: "glob", content: [{ type: "text", text: big() }] }) as { content: Array<{ text: string }> };
    expect(globbed.content[0].text).toBe("small");

    expect(await h.fire({ toolName: "read", content: [{ type: "text", text: big() }] })).toBeUndefined();
    expect(called, "read spawns no filter").toBe(1);
  });
});

test("small, error, mixed, and empty results are left alone", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    let called = 0;
    const exec: FilterExec = async () => { called += 1; return { stdout: "x", code: 0 }; };
    const h = harness(exec, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    expect(await h.fire(grepEvent("src/a.ts:1:tiny\n"))).toBeUndefined();
    expect(await h.fire({ ...grepEvent(big()), isError: true })).toBeUndefined();
    expect(await h.fire({ toolName: "grep", content: [{ type: "text", text: big() }, { type: "image" }] })).toBeUndefined();
    expect(await h.fire({ toolName: "grep", content: [] })).toBeUndefined();
    expect(await h.fire({ toolName: "grep" })).toBeUndefined();
    expect(called, "none of those reach the filter").toBe(0);
  });
});

test("rtk off, a failed filter, and a filter that would grow the text all keep the original", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    const text = big();
    const off = harness(async () => ({ stdout: "short", code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: false } }]);
    expect(await off.fire(grepEvent(text))).toBeUndefined();

    const failing = harness(async () => ({ stdout: "short", code: 2 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await failing.fire(grepEvent(text)), "a non-zero exit is untrustworthy").toBeUndefined();

    const growing = harness(async () => ({ stdout: `${text}${text}`, code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await growing.fire(grepEvent(text))).toBeUndefined();

    const blank = harness(async () => ({ stdout: "   \n", code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await blank.fire(grepEvent(text))).toBeUndefined();

    const throwing = harness(async () => { throw new Error("spawn sh ENOENT"); }, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await throwing.fire(grepEvent(text))).toBeUndefined();
  });
});

test("a host without exec registers nothing", () => {
  resetSharedComboState();
  const h = harness(undefined, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  expect(h.has("tool_result")).toBe(false);
});

// OpenCode's adapter drives its own before/after tool hooks, so these events never reach an extension there.
test("a host without a tool lifecycle registers no shell hook", async () => {
  // The gate runs after the binary lookup, so the test has to supply one; without it a CI runner stops even earlier and the assertion would pass for the wrong reason.
  await withFakeRtk(async () => {
    resetSharedComboState();
    const handlers = new Map<string, Handler>();
    const api: Record<string, unknown> = {
      hostId: "opencode",
      setLabel() {},
      registerCommand() {},
      registerTool() {},
      appendEntry() {},
      on(event: string, handler: Handler) { handlers.set(event, handler); },
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      cwd: "/tmp",
    };
    rtkFilterExtension(api as unknown as ExtensionApi);
    expect(handlers.size, "a handler here would never fire").toBe(0);

    // The same host shape without the id is pi, which does fire both events.
    const piHandlers = new Map<string, Handler>();
    rtkFilterExtension({
      ...api,
      hostId: undefined,
      on(event: string, handler: Handler) { piHandlers.set(event, handler); },
    } as unknown as ExtensionApi);
    expect([...piHandlers.keys()].toSorted()).toEqual(["tool_call", "tool_result"]);
  });
});

test("rtkActive prefers the session entry over the shared switch", () => {
  resetSharedComboState();
  setSharedComboMode("rtk", "on");
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { enabled: false } }]), "an explicit /rtk off wins").toBe(false);
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { enabled: true } }])).toBe(true);
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { mode: "nonsense" } }]), "a malformed entry falls back").toBe(true);
  expect(rtkActive(undefined)).toBe(true);
  // This file now holds what were separate files, so a switch left on would decide for the tests below.
  resetSharedComboState();
});

test("filterableText decodes plain text parts and refuses everything else", () => {
  expect(filterableText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  expect(filterableText([{ type: "text" }]), "a part with no text reads as empty").toBe("");
  expect(filterableText([{ type: "text", text: "a" }, { type: "image" }])).toBeNull();
  expect(filterableText([])).toBeNull();
  expect(filterableText(undefined)).toBeNull();
  expect(filterableText("already a string"), "OpenCode hands parts, never a bare string").toBeNull();
});

test("filterThroughRtk reports null instead of throwing when the binary is gone", async () => {
  const exec: FilterExec = async () => { throw new Error("spawn sh ENOENT"); };
  const gone = path.join(tmpdir(), "tersio-no-rtk", "rtk");
  expect(await filterThroughRtk(exec, { bin: gone, filter: "grep", text: big() })).toBeNull();
});

// ===== rtk-gain.test.ts =====

function withDb(db: string | undefined, fn: () => void): void {
  const prev = process.env.TERSIO_RTK_DB;
  if (db === undefined) delete process.env.TERSIO_RTK_DB;
  else process.env.TERSIO_RTK_DB = db;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TERSIO_RTK_DB;
    else process.env.TERSIO_RTK_DB = prev;
  }
}

test("missing rtk db returns empty gain without throwing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  try {
    withDb(path.join(dir, "nope.db"), () => {
      expect(readRtkGain()).toEqual({ commands: 0, saved: 0, input: 0, avgPct: 0, totalMs: 0, byCommand: [], measured: false });
      // An absent database is a failed read, not a measured zero.
      expect(rtkGainFailure()).toContain("no rtk database");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("aggregates per-command savings from history.db", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    sqliteExec(db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','git status','rtk git status',100,50,50,90.0,20,'/tmp');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',900,800,100,10.0,40,'/tmp');",
      "INSERT INTO commands VALUES (3,'2026-09-01T00:02:00Z','grep foo','rtk grep',1000,900,100,10.0,600,'/tmp');",
    ].join(" "));
    withDb(db, () => {
      const g = readRtkGain();
      expect(g.commands).toBe(3);
      expect(g.saved).toBe(250);
      expect(g.input).toBe(2000);
      expect(Math.abs(g.avgPct - (250 / 2000) * 100) < 1e-9).toBeTruthy();
      expect(g.byCommand.length).toBe(2);
      expect(g.byCommand[0]).toEqual({ command: "rtk git status", count: 2, saved: 150, avgPct: 15, avgMs: 30 });
      expect(g.byCommand[1]).toEqual({ command: "rtk grep", count: 1, saved: 100, avgPct: 10, avgMs: 600 });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("cutoff filters the view without touching the db", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    sqliteExec(db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','git status','rtk git status',100,50,50,50.0,20,'/tmp');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',200,100,100,50.0,40,'/tmp');",
      "INSERT INTO commands VALUES (3,'2026-09-13T12:00:00Z','grep foo','rtk grep',1000,900,100,10.0,600,'/tmp');",
    ].join(" "));
    withDb(db, () => {
      const cutoff = Date.parse("2026-09-13T00:00:00Z");
      const g = readRtkGain(10, cutoff);
      expect(g.commands, "only post-cutoff rows in the view").toBe(1);
      expect(g.saved).toBe(100);
      expect(g.byCommand.length).toBe(1);
      const all = readRtkGain();
      expect(all.commands).toBe(3);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("folds thousands of full commands into one row per leading verb", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    sqliteExec(db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      // Three distinct `rtk ls` spellings, so the verb folds them and names the count.
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','ls a','rtk ls a',100,10,90,90.0,10,'/tmp');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','ls b','rtk ls b',200,20,180,90.0,30,'/tmp');",
      "INSERT INTO commands VALUES (3,'2026-09-01T00:02:00Z','ls -R c','rtk ls -R c',300,30,270,90.0,20,'/tmp');",
      "INSERT INTO commands VALUES (4,'2026-09-01T00:03:00Z','read x','rtk read x',1000,10,990,99.0,50,'/tmp');",
      // A subcommand verb: `rtk git status` is the git verb, not a bare `rtk`.
      "INSERT INTO commands VALUES (5,'2026-09-01T00:04:00Z','git status','rtk git status',10,20,-10,-100.0,5,'/tmp');",
    ].join(" "));
    withDb(db, () => {
      const g = readRtkGainByVerb(10);
      expect(g.measured).toBe(true);
      expect(rtkGainFailure()).toBe(null);
      expect(g.commands).toBe(5);
      expect(g.byCommand.map((row) => row.command)).toEqual(["rtk read", "rtk ls", "rtk git"]);
      const ls = g.byCommand.find((row) => row.command === "rtk ls")!;
      expect(ls.variants, "three spellings fold into one verb").toBe(3);
      expect(ls.count).toBe(3);
      expect(ls.saved).toBe(540);
      // The verb's rate is its own saved bytes over its own input, not a mean of per-command rates.
      expect(ls.avgPct).toBeCloseTo((540 / 600) * 100, 9);
      // A command that cost more than it saved stays negative, so a wrapper losing bytes is visible.
      const git = g.byCommand.find((row) => row.command === "rtk git")!;
      expect(git.saved).toBe(-10);
      expect(git.avgPct).toBeLessThan(0);
      // `limit` bounds the folded rows, biggest saving first.
      expect(readRtkGainByVerb(1).byCommand.map((row) => row.command)).toEqual(["rtk read"]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default db path follows the platform", () => {
  withDb(undefined, () => {
    const p = rtkDbPath();
    expect(p.endsWith("history.db"), p).toBeTruthy();
  });
});

test.skipIf(!hasSqlite())("multi-line commands stay one row", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    sqliteExec(db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      // heredoc-style command: real rows look like this, newlines and all
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','node -e','rtk fallback: node -e",
      "const a = 1;",
      "const b = 2;',300,100,200,66.0,10,'/repos/multi');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',100,50,50,50.0,20,'/repos/multi');",
    ].join(" "));
    withDb(db, () => {
      const g = readRtkGain(50);
      expect(g.byCommand.length, "one row per command, not one per physical line").toBe(2);
      for (const r of g.byCommand) {
        expect(!r.command.includes("\n"), "commands are flattened for the table").toBeTruthy();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("same command across repos folds into one row", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    sqliteExec(db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/busy');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/busy');",
      "INSERT INTO commands VALUES (3,'2026-09-01T00:02:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/quiet');",
      "INSERT INTO commands VALUES (4,'2026-09-01T00:03:00Z','bun run build','rtk bun run build (passthrough)',100,0,0,0.0,5,'/repos/quiet');",
      `INSERT INTO commands VALUES (5,'2026-09-01T00:04:00Z','ls','rtk ls -d ${"x".repeat(400)}',100,0,0,0.0,5,'/repos/quiet');`,
    ].join(" "));
    withDb(db, () => {
      const g = readRtkGain(50);
      expect(g.commands, "totals stay machine-wide").toBe(5);
      const grep = g.byCommand.filter((r) => r.command === "rtk grep");
      expect(grep.length, "same command in two repos is one row").toBe(1);
      expect(grep[0].count).toBe(3);
      // A zero-saving command still reaches the table; old rows ranked by tokens saved dropped it.
      expect(g.byCommand.some((r) => r.command === "rtk bun run build (passthrough)")).toBeTruthy();
      expect(g.byCommand.find((r) => r.command.startsWith("rtk ls -d "))?.command.length).toBe(200);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===== rtk-omp-wiring.test.ts =====

// Fake rtk binary: logs its argv beside it, exits with the given code; hermetic, never touches a real OMP dir.
function fakeRtk(dir: string, code = 0): string {
  // `echo %*>>"file"` is the batch idiom for appending the args, with no space before the redirect.
  return fakeRtkBin(
    dir,
    [`echo "$@" >> "${path.join(dir, "invocations.log")}"`, `exit ${code}`],
    `echo %*>> "${path.join(dir, "invocations.log")}"\nexit /b ${code}`,
  );
}

function tempHome(): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-wire-"));
  return { dir, log: path.join(dir, "invocations.log") };
}

test("dry-run prints the would-run line and never executes the binary", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtk(fakeRtk(dir), 'omp', { dryRun: true });
    expect(ok).toBe(true);
    expect(existsSync(log), "fake binary must not run in dry-run").toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("success path runs init -g --agent omp once", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtk(fakeRtk(dir), 'omp', {});
    expect(ok).toBe(true);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toEqual(["init -g --agent omp"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failing binary returns false without throwing", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtk(fakeRtk(dir, 3), 'omp', {});
    expect(ok).toBe(false);
    expect(readFileSync(log, "utf8")).toMatch(/init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opencode never installs a separate rtk plugin", async () => {
  const { dir, log } = tempHome();
  try {
    expect(await wireRtk(fakeRtk(dir), 'opencode', {})).toBe(true);
    expect(existsSync(log), "the tersio plugin owns the rewrite").toBe(false);
    expect(await wireRtk(fakeRtk(dir), 'opencode', { dryRun: true })).toBe(true);
    expect(await wireRtk(path.join(dir, "absent-rtk"), 'opencode', {}), "no binary, no rewrite").toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The wiring only invokes rtk; prove the real hook rewrites, skipped when rtk is absent (others cover that).
const realRtk = resolveRtkBinary();

/** Wires one host against real rtk and returns its `tool_call` hook's command; omp and pi share hooks. */
async function rewiredCommand(
  host: 'omp' | 'pi' | 'pig',
  hookPath: string[],
): Promise<{ command: string | null; registered: boolean }> {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-real-"));
  const prevHome = process.env.HOME;
  // PiG's own root variables would move the hook out of this fixture home.
  const pigVars = ["XDG_CONFIG_HOME", "PIG_HOME", "PIG_CODING_AGENT_DIR", "PIG_USE_PI_DIRS"] as const;
  const prevPig = pigVars.map((name) => process.env[name]);
  try {
    process.env.HOME = home;
    for (const name of pigVars) delete process.env[name];
    if (!(await wireRtk(realRtk!, host, { quiet: true }))) return { command: null, registered: false };

    const hook = path.join(home, ...hookPath);
    if (!existsSync(hook)) return { command: null, registered: false };

    // The generated hook is a TS module whose default export registers a `tool_call` handler.
    const ext = (await import(pathToFileURL(hook).href)).default as (pi: unknown) => Promise<void>;
    let call: { input: { command: string } } | undefined;
    let settled: Promise<unknown> | undefined;
    const api = {
      setLabel() {},
      registerCommand() {},
      registerTool() {},
      appendEntry() {},
      // The hook rewrites via `rtk rewrite`, so `exec` must accept a timeout and signal and report a kill.
      async exec(cmd: string, args: string[], opts?: { timeout?: number; signal?: AbortSignal }) {
        const { execFile } = await import("node:child_process");
        return new Promise((resolve) => {
          execFile(cmd, args, { timeout: opts?.timeout ?? 5000 }, (error, stdout) => {
            if (opts?.signal?.aborted) return resolve({ code: 1, stdout: "", killed: true });
            const raw = (error as { code?: unknown } | null)?.code;
            resolve({ code: typeof raw === "number" ? raw : 0, stdout: String(stdout || ""), killed: false });
          });
        });
      },
      on(event: string, handler: (e: unknown, ctx: unknown) => unknown) {
        if (event !== "tool_call") return;
        call = { toolName: "bash", input: { command: "grep -rn foo ." } } as unknown as { input: { command: string } };
        // The handler is async, so the mutation has to be awaited before it can be read.
        settled = Promise.resolve(handler(call, { signal: undefined }));
      },
    };
    await ext(api);
    await settled;
    return { command: call?.input.command ?? null, registered: settled !== undefined };
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    pigVars.forEach((name, index) => {
      const value = prevPig[index];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    });
    rmSync(home, { recursive: true, force: true });
  }
}

const HOOK_TAIL = [".omp", "agent", "extensions", "rtk.ts"] as const;
const PI_HOOK_TAIL = [".pi", "agent", "extensions", "rtk.ts"] as const;
const PIG_HOOK_TAIL = [".pig", "agent", "extensions", "rtk.ts"] as const;

test.skipIf(!realRtk || process.platform === "win32")("the wired omp hook rewrites a bash command", async () => {
  const wired = await rewiredCommand('omp', [...HOOK_TAIL]);
  expect(wired.registered, "rtk init must have written a hook that registers tool_call").toBe(true);
  expect(wired.command, "the generated hook must rewrite a bash command through rtk")
    .toBe("rtk grep -rn foo .");
});

// Same invocation, same hook, different agent directory: pi gets the same proof, not a second integration.
test.skipIf(!realRtk || process.platform === "win32")("the wired pi hook rewrites a bash command", async () => {
  const wired = await rewiredCommand('pi', [...PI_HOOK_TAIL]);
  expect(wired.registered, "rtk init must have written a hook that registers tool_call").toBe(true);
  expect(wired.command, "the generated hook must rewrite a bash command through rtk")
    .toBe("rtk grep -rn foo .");
});

test.skipIf(!realRtk || process.platform === "win32")("the wired pig hook rewrites a bash command", async () => {
  const wired = await rewiredCommand('pig', [...PIG_HOOK_TAIL]);
  expect(wired.registered, "rtk init must have written a hook that registers tool_call").toBe(true);
  expect(wired.command, "the generated hook must rewrite a bash command through rtk")
    .toBe("rtk grep -rn foo .");
});

// ===== rtk-platform.test.ts =====

test("resolveRtkBinary returns null when PATH has no executable", () => {
  const previous = process.env.PATH;
  process.env.PATH = path.resolve("definitely-missing-bin");
  try {
    expect(resolveRtkBinary(path.resolve("definitely-missing-bin"))).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

test("resolveRtkBinary falls back to the managed installer directory", () => {
  const previousPath = process.env.PATH;
  const managed = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-managed-"));
  const binary = path.join(managed, process.platform === "win32" ? "rtk.exe" : "rtk");
  writeFileSync(binary, "#!/bin/sh\necho rtk 0.50.0\n", "utf8");
  if (process.platform !== "win32") chmodSync(binary, 0o755);
  process.env.PATH = path.join(managed, "missing");
  try {
    expect(resolveRtkBinary(managed)).toBe(binary);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(managed, { recursive: true, force: true });
  }
});
test("rtkPlatformSpec returns null for unknown platforms", () => {
  expect(rtkPlatformSpec("plan9", "x64")).toBe(null);
});

// ===== rtk-tool.test.ts =====

// resolveRtkBinary checks PATH first, so each test must own PATH.
function withPath(value: string, work: () => Promise<void>): Promise<void> {
  const previous = process.env.PATH;
  process.env.PATH = value;
  return work().finally(() => { process.env.PATH = previous; });
}

// A resolved rtk path with PATH cleared, so the exec paths run on a machine with no rtk installed.
function withRtkBinary(work: () => Promise<void>): Promise<void> {
  const binDir = path.join(process.env.HOME as string, ".bun", "bin");
  mkdirSync(binDir, { recursive: true });
  fakeRtkBin(binDir, ["echo hi"], "echo hi");
  return withPath("", work).finally(() => { rmSync(binDir, { recursive: true, force: true }); });
}

type Exec = (cmd: string, args: string[], opts?: { signal?: AbortSignal; cwd?: string }) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}>;

type Tool = {
  name: string;
  execute: (id: string, params: { args: string[] }, signal?: AbortSignal, onUpdate?: unknown, ctx?: ExtensionCtx) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

interface Harness { tool: Tool; ctx: ExtensionCtx; events: string[]; sessionStart: () => Promise<unknown>; }

/** `exec` is optional in the API, so the harness controls whether it exists. */
function rtkToolHarness(exec?: Exec, entries: Array<{ type: string; customType: string; data: Record<string, unknown> }> = []): Harness {
  let tool: Tool | undefined;
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>>();
  const chain = { min: () => chain, describe: () => chain };
  const api: Record<string, unknown> = {
    setLabel() {},
    registerCommand() {},
    registerTool(t: Tool) { tool = t; },
    appendEntry() {},
    on(event: string, handler: (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>) { handlers.set(event, handler); },
    zod: { z: { object: (shape: Record<string, unknown>) => shape, array: () => chain, string: () => chain } },
    cwd: "/tmp",
  };
  if (exec) api.exec = exec;
  rtkSessionExtension(api as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { setStatus() {}, notify() {} },
  } as ExtensionCtx;
  const sessionStart = () => handlers.get("session_start")!({}, ctx);
  return { tool: tool!, ctx, events: [...handlers.keys()], sessionStart };
}

const text = (r: { content: Array<{ text: string }> }): string => r.content.map((c) => c.text).join("\n");

test("rtk_run runs the command plainly while RTK is off", async () => {
  // The tool is the only one left when the host runs with --no-tools, so a refusal there made the model spend turns re-calling it. rtk is the condenser, never the command.
  const cmds: Array<{ cmd: string; args: string[] }> = [];
  const h = rtkToolHarness(async (cmd, args) => { cmds.push({ cmd, args }); return { stdout: "plain out", stderr: "", code: 0, killed: false }; });
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(false);
  expect(text(r)).toContain("plain out");
  expect(cmds).toEqual([{ cmd: "ls", args: ["ls"] }]);
  expect(r.details?.condensed).toBe(false);
});

test("a host without exec reports it instead of throwing", async () => {
  const h = rtkToolHarness(undefined, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/cannot run rtk/);
});

test("a spawn failure reports the error instead of crashing the tool", async () => {
  await withRtkBinary(async () => {
    const h = rtkToolHarness(async () => { throw new Error("spawn rtk ENOENT"); },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("spawn rtk ENOENT");
  });
});

test("a non-zero exit is surfaced as an error with its output", async () => {
  await withRtkBinary(async () => {
    const h = rtkToolHarness(async () => ({ stdout: "", stderr: "bad flag", code: 2, killed: false }),
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["--nope"] }, undefined, undefined, h.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("bad flag");
  });
});

test("a successful run returns combined output and no error", async () => {
  await withRtkBinary(async () => {
    const seen: string[][] = [];
    const h = rtkToolHarness(async (_cmd, args) => { seen.push(args); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);
    expect(r.isError).toBe(false);
    expect(text(r)).toBe("ok");
    // The exec is the shim the product builds, so the expectation comes from the same helper.
    const bin = resolveRtkBinary() as string;
    expect(seen).toEqual([shimCommand(bin, ["git", "status"]).args]);
  });
});

test("RTK no longer registers a natural-language input handler", () => {
  // "use rtk" is ordinary English; combo-toggle dropped its input hook for that reason, and RTK does too.
  expect(rtkToolHarness().events).not.toContain("input");
});

test("the tool execs the resolved rtk path, not bare `rtk`", async () => {
  // A GUI-launched host whose PATH lacks ~/.bun/bin ENOENTs on bare 'rtk'.
  await withPath("", async () => {
    const binDir = path.join(process.env.HOME as string, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = fakeRtkBin(binDir, ["echo hi"], "echo hi");

    const cmds: string[] = [];
    const h = rtkToolHarness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);

    expect(r.isError).toBe(false);
    // A `.cmd` runs through the shell on Windows, so the exec name comes from the same helper.
    expect(cmds).toEqual([shimCommand(fake, []).cmd]);
    rmSync(binDir, { recursive: true, force: true });
  });
});

test("rtk mode on with no installed binary reports it instead of guessing", async () => {
  // A fresh HOME, so a sibling test's managed `~/.bun/bin` cannot answer the resolver.
  await inHome(() => withPath("", async () => {
    const cmds: string[] = [];
    const h = rtkToolHarness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/rtk binary is not installed/);
    expect(cmds).toEqual([]);
  }));
});

// A late subagent registers its listener late, so it keeps the session default and needs shared state.
test("rtk_run uses shared state when a late subagent's own flag is off", async () => {
  resetSharedComboState();
  const binDir = path.join(process.env.HOME as string, ".bun", "bin");
  await withPath("", async () => {
    mkdirSync(binDir, { recursive: true });
    const fake = fakeRtkBin(binDir, ["echo hi"], "echo hi");
    setSharedComboMode("rtk", "on");
    const cmds: string[] = [];
    // No session_start: this instance's own flag is still its start-up default.
    const sub = rtkToolHarness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; });

    const r = await sub.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, sub.ctx);

    expect(r.isError).toBe(false);
    // A `.cmd` runs through the shell on Windows, so the exec name comes from the same helper.
    expect(cmds, "shared state turned rtk on, so the resolved path runs").toEqual([shimCommand(fake, []).cmd]);
    expect(r.details?.condensed).toBe(true);
    resetSharedComboState();
    rmSync(binDir, { recursive: true, force: true });
  });
});

test("rtk mode off with no shared state still runs the command plainly", async () => {
  resetSharedComboState();
  await withPath("", async () => {
    setSharedComboMode("rtk", "off");
    const cmds: string[] = [];
    const h = rtkToolHarness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; });

    const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);

    expect(r.isError).toBe(false);
    expect(cmds, "the command runs uncondensed, not through rtk").toEqual(["git"]);
    resetSharedComboState();
  });
});

// ===== find-file.test.ts =====

function fixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-find-"));
  mkdirSync(path.join(dir, "nested", "deep"), { recursive: true });
  writeFileSync(path.join(dir, "nested", "deep", "rtk"), "bin");
  writeFileSync(path.join(dir, "README.md"), "docs");
  return dir;
}

test("findFile locates a nested binary by exact name", async () => {
  const dir = fixture();
  try {
    expect(await findFile(dir, "rtk")).toBe(path.join(dir, "nested", "deep", "rtk"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findFile skips doc files when matching rtk-like names", async () => {
  const dir = fixture();
  try {
    expect(await findFile(dir, "README.md")).toBe(path.join(dir, "README.md"));
    expect(await findFile(dir, "missing")).toBe(null);
    expect(await findFile("/nonexistent-tersio-dir", "rtk")).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===== timing.test.ts =====

type timingHandler = (event: unknown, ctx: unknown) => unknown;

function fakeHost(): { handlers: Map<string, timingHandler[]>; fire: (name: string, event: unknown) => Promise<void> } {
  const handlers = new Map<string, timingHandler[]>();
  const pi = {
    hostId: "pi",
    on(event: string, handler: timingHandler) {
      (handlers.get(event) ?? handlers.set(event, []).get(event)!).push(handler);
    },
  };
  timingExtension(pi as never);
  return {
    handlers,
    async fire(name, event) {
      for (const handler of handlers.get(name) ?? []) await handler(event, {});
    },
  };
}

const assistant = (timestamp: number): { role: string; timestamp: number; ttft?: number } => ({ role: "assistant", timestamp });

test("the first token gap is stamped onto the message", async () => {
  const { fire } = fakeHost();
  const started = 1_700_000_000_000;
  const message = assistant(started);
  await fire("message_start", { message });
  // `start` opens the stream with no token yet, so it must not count as the first one.
  await fire("message_update", { message, assistantMessageEvent: { type: "start" } });
  expect(message.ttft, "a bare start is not a token").toBeUndefined();
  await fire("message_update", { message, assistantMessageEvent: { type: "text_delta", delta: "h" } });
  await fire("message_update", { message, assistantMessageEvent: { type: "text_delta", delta: "i" } });
  await fire("message_end", { message });
  expect(message.ttft, "the first delta sets the latency").toBeGreaterThan(0);
});

test("a host that recorded its own latency keeps it", async () => {
  const { fire } = fakeHost();
  const message = { ...assistant(1_700_000_000_000), ttft: 42 };
  await fire("message_start", { message });
  await fire("message_update", { message, assistantMessageEvent: { type: "text_delta", delta: "x" } });
  await fire("message_end", { message });
  expect(message.ttft, "the host's own value wins").toBe(42);
});

test("a message with no first token records nothing", async () => {
  const { fire } = fakeHost();
  const message = assistant(1_700_000_000_000);
  await fire("message_start", { message });
  await fire("message_end", { message });
  expect(message.ttft, "no token means no latency, never zero").toBeUndefined();
});

test("non-assistant messages are left alone", async () => {
  const { fire } = fakeHost();
  const message: { role: string; timestamp: number; ttft?: number } = { role: "toolResult", timestamp: 1_700_000_000_000 };
  await fire("message_start", { message });
  await fire("message_update", { message, assistantMessageEvent: { type: "text_delta", delta: "x" } });
  await fire("message_end", { message });
  expect(message.ttft).toBeUndefined();
});
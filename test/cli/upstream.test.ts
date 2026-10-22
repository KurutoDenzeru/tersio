// The scorecard's pure parts: a git blob id must match git's, every shipped pstack body must map to
// the upstream path it came from, and accuracy must count a fork that is present as a match.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { accuracyOf, cavemanAssetGap, driftOf, gapsOf, gateFails, gateReasons, gitBlobSha, hostBroken, hostFix, pstackUpstreamPath, scorecardMarkdown, skillRoot, uncarriedOf, vendoredVerdict, zipEntries } from "../../cli/upstream.ts";
import type { HostRow, Scorecard, SourceRow, TreeResult } from "../../cli/upstream.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PSTACK = path.join(root, "extensions", "pstack");

function pstackFiles(dir = PSTACK, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...pstackFiles(path.join(dir, entry.name), child));
    else if (entry.name.endsWith(".md")) out.push(child);
  }
  return out;
}

test("gitBlobSha reproduces git's own blob id", () => {
  const result = spawnSync("git", ["hash-object", "--stdin"], { input: "hello", encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(gitBlobSha("hello")).toBe(result.stdout.trim());
});

test("every shipped pstack body maps to an upstream path", () => {
  expect(pstackUpstreamPath("rule.md")).toBe("pstack/skills/poteto-mode/SKILL.md");
  expect(pstackUpstreamPath("playbooks/feature.md")).toBe("pstack/skills/poteto-mode/playbooks/feature.md");
  expect(pstackUpstreamPath("principles/prove-it-works.md")).toBe("pstack/skills/principle-prove-it-works/SKILL.md");
  expect(pstackUpstreamPath("skills/swarm/SKILL.md")).toBe("pstack/skills/swarm/SKILL.md");
  expect(pstackUpstreamPath("index.ts")).toBe(null);
  for (const file of pstackFiles()) {
    expect(pstackUpstreamPath(file), `${file} has no upstream path`).not.toBe(null);
  }
});

/** One source row, so a literal states only what the test is about. */
function row(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    source: "x", pin: "", upstream: "", tracked: 2, matched: 2, drift: 0, added: 0, removed: 0, ceiling: 0,
    measured: true, status: "ok", kind: "bytes", link: "", gaps: [], moved: [], appeared: [], gone: [], note: "",
    uncarried: 0, uncarriedMoved: 0,
    ...overrides,
  };
}

/** One host row, with no file names unless the test asks for them. */
function hostRow(overrides: Partial<HostRow> = {}): HostRow {
  return { host: "omp", installed: true, files: 2, matched: 2, stale: 0, missing: 0, staleFiles: [], missingFiles: [], unloaded: [], fix: "", ...overrides };
}

/** One tree, as the scorecard reads it. */
function tree(entries: Array<[string, string]>): TreeResult {
  return { entries: new Map(entries), failure: null };
}

test("a new upstream skill directory is reported, not only a new file in a tracked one", () => {
  const tracked = ["pstack/skills/poteto-mode/SKILL.md"];
  const pinned = tree([["pstack/skills/poteto-mode/SKILL.md", "a"]]);
  const head = tree([["pstack/skills/poteto-mode/SKILL.md", "a"], ["pstack/skills/new-skill/SKILL.md", "b"]]);
  const drift = driftOf(pinned, head, tracked);
  expect(drift.added).toEqual(["pstack/skills/new-skill/SKILL.md"]);
});

test("the skills upstream publishes that this port does not carry are counted, and the moved ones named", () => {
  const tracked = ["pstack/skills/why/SKILL.md", "pstack/skills/architect/SKILL.md"];
  const pinned = tree([["pstack/skills/why/SKILL.md", "a"], ["pstack/skills/architect/SKILL.md", "a"], ["pstack/skills/other/SKILL.md", "c"]]);
  const head = tree([["pstack/skills/why/SKILL.md", "a"], ["pstack/skills/architect/SKILL.md", "a"], ["pstack/skills/other/SKILL.md", "b"]]);
  const out = uncarriedOf(pinned, head, tracked, skillRoot(tracked));
  expect(out.count).toBe(1);
  expect(out.moved).toBe(1);
});

test("a vendored body that differs from the package it declares is a gap", () => {
  const integrity = "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=";
  expect(vendoredVerdict("skills/ponytail/SKILL.md", Buffer.from("hello"), integrity, "5.3.2")).toBe(null);
  expect(vendoredVerdict("skills/ponytail/SKILL.md", Buffer.from("hello!"), integrity, "5.3.2")).toBe("skills/ponytail/SKILL.md differs from the package at 5.3.2");
  expect(vendoredVerdict("skills/ponytail/SKILL.md", null, integrity, "5.3.2")).toBe("skills/ponytail/SKILL.md is missing from the vendored copy");
  expect(vendoredVerdict("skills/ponytail/SKILL.md", Buffer.from("hello"), undefined, "5.3.2")).toBe("skills/ponytail/SKILL.md is not in the package at 5.3.2");
});

test("accuracy counts sources and only installed hosts", () => {
  const sources = [row({ tracked: 4, matched: 3 })];
  const hosts = [
    hostRow({ files: 4, matched: 2, stale: 1, missing: 1 }),
    hostRow({ host: "pi", installed: false, files: 100, matched: 0 }),
  ];
  // 3 + 2 matched over 4 + 4 tracked: an absent host must not drag the number down.
  expect(accuracyOf(sources, hosts)).toBe(62.5);
  expect(accuracyOf([], [])).toBe(100);
});

function makeCard(sources: SourceRow[], hosts: HostRow[]): Scorecard {
  return { version: "0", checkedAt: 0, sources, hosts, accuracy: accuracyOf(sources, hosts), drift: sources.reduce((s, r) => s + r.drift, 0) };
}

const clean: SourceRow = row();
const host: HostRow = hostRow();

/** A zip archive with deflated entries, built the way a release asset is built. */
function zipFixture(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("a release asset that differs from the bundled body is a gap", () => {
  const body = readFileSync(path.join(root, "extensions", "caveman", "rule.md"), "utf8");
  expect(cavemanAssetGap(body, body), "the asset carries the body this port ships").toBe(null);
  expect(cavemanAssetGap(body, null)).toBe("caveman/rule.md is missing locally");
  expect(cavemanAssetGap(`${body}\nmutated\n`, body)).toBe("caveman/rule.md differs from the release asset");
});

test("the zip reader returns every file the release asset carries", () => {
  const archive = zipFixture({ "caveman/SKILL.md": "# body\n", "caveman/README.md": "# readme\n" });
  const entries = zipEntries(archive);
  expect(entries.get("caveman/SKILL.md")?.toString("utf8")).toBe("# body\n");
  expect(entries.get("caveman/README.md")?.toString("utf8")).toBe("# readme\n");
  expect(entries.size, "every entry in the archive").toBe(2);
});

test("a stale host fails a plain run, drift only fails under --strict", () => {
  const drifted = makeCard([{ ...clean, drift: 3, ceiling: 3 }], [host]);
  expect(gateFails(drifted, false)).toBe(false);
  expect(gateFails(drifted, true)).toBe(false);
  // Upstream moved past what was reviewed: the scheduled job must say so.
  expect(gateFails(makeCard([{ ...clean, drift: 4, ceiling: 3 }], [host]), true)).toBe(true);
  expect(gateFails(makeCard([{ ...clean, drift: 4, ceiling: 3 }], [host]), false)).toBe(false);

  const stale = makeCard([clean], [{ ...host, matched: 1, stale: 1 }]);
  expect(hostBroken(stale)).toBe(true);
  expect(gateFails(stale, false)).toBe(true);

  // A rate-limited run cannot prove anything, so strict must not pass on it.
  expect(gateFails(makeCard([row({ status: "offline", measured: false })], [host]), true)).toBe(true);
  expect(gateFails(makeCard([row({ status: "offline", measured: false })], [host]), false)).toBe(false);

  // A missing source body is a gap of ours, so it fails even without --strict.
  const short = makeCard([{ ...clean, matched: 1 }], [host]);
  expect(gateFails(short, false)).toBe(true);
  expect(gateFails(makeCard([clean], [host]), true)).toBe(false);
});

test("a stale host row names the command that repairs it", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-upstream-fix-"));
  const prev = process.env.TERSIO_HOME;
  process.env.TERSIO_HOME = home;
  try {
    // The installed package is behind this build: reinstall that host.
    expect(hostFix("omp", "0.0.1")).toBe("run: tersio install --host omp");
    // The installed package is ahead of this build: the build is behind, so update it.
    expect(hostFix("omp", "99.0.0")).toBe("run: tersio update");
  } finally {
    if (prev === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a pin that is gone upstream fails a plain run, not just --strict", () => {
  // The pin is the whole comparison, so a 404 on it means the scorecard proved nothing: accuracy would
  // stay 100 on a zero-tracked row, and a silent pass is exactly what the scheduled job must not do.
  const dead = makeCard([row({ status: "pin-missing", measured: false, tracked: 0, matched: 0 })], [host]);
  expect(accuracyOf(dead.sources, dead.hosts)).toBe(100);
  expect(gateFails(dead, false)).toBe(true);
  expect(gateReasons(dead, false)).toEqual(expect.arrayContaining([expect.stringContaining("gone upstream")]));
});

test("every gap is named with whose move it was", () => {
  const card = makeCard(
    [row({ source: "Caveman", gaps: ["caveman/rule.md differs from the pin"], moved: ["skills/caveman/SKILL.md"], appeared: ["skills/newthing/SKILL.md"], gone: ["skills/old/SKILL.md"] })],
    [hostRow({ staleFiles: ["rtk/filter.ts"], missingFiles: ["combo/index.ts"], stale: 1, missing: 1, matched: 0, files: 2 })],
  );
  const gaps = gapsOf(card);
  // Ours first, loudest first: a missing file is worse than a stale one, and drift is a review to schedule.
  expect(gaps.map((g) => g.kind)).toEqual(["ours", "ours", "ours", "drift", "drift", "drift"]);
  expect(gaps.map((g) => g.text)).toEqual([
    "caveman/rule.md differs from the pin",
    "missing: combo/index.ts",
    "stale: rtk/filter.ts",
    "moved upstream: skills/caveman/SKILL.md",
    "new upstream: skills/newthing/SKILL.md",
    "gone upstream: skills/old/SKILL.md",
  ]);
  // Every gap reaches the report, and a run with none says so rather than printing an empty section.
  const md = scorecardMarkdown(card);
  for (const gap of gaps) expect(md).toContain(gap.text);
  expect(scorecardMarkdown(makeCard([clean], [host]))).toContain("No gaps:");
});

test("an extension a host's manifest never names is a gap, though the file is present", () => {
  // The byte compare cannot see this one: the tree carries the module and the manifest never loads it.
  const card = makeCard(
    [row({ source: "Caveman", drift: 1, moved: ["skills/caveman/SKILL.md"], link: "https://github.com/JuliusBrussee/caveman/compare/abc1234...HEAD" })],
    [hostRow({ unloaded: ["extensions/pstack/index.ts"] })],
  );
  expect(gateFails(card, false)).toBe(true);
  expect(gateReasons(card, false).join("\n")).toContain("never load");
  const md = scorecardMarkdown(card);
  expect(md).toContain("not loaded: extensions/pstack/index.ts");
  expect(md).toContain("moved upstream: skills/caveman/SKILL.md");
  // One link per moved source, so a reviewer lands on the diff the pin named.
  expect(md).toContain("Review the diff: https://github.com/JuliusBrussee/caveman/compare/abc1234...HEAD");
});

test("the markdown report carries a table per group, a bar, and a chart", () => {
  const report: Scorecard = {
    version: "9.9.9",
    checkedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    sources: [row({ source: "Caveman", pin: "abc1234", upstream: "HEAD", tracked: 2, matched: 1 })],
    hosts: [hostRow({ files: 4, matched: 3, stale: 1 })],
    accuracy: 66.7,
    drift: 0,
  };
  const md = scorecardMarkdown(report);
  expect(md).toContain("| Caveman | abc1234 | HEAD | 1/2 |");
  expect(md).toContain("| omp | yes | 3/4 | 1 | 0 |");
  // The bar is text, so the report still reads with no renderer.
  expect(md).toContain("Caveman   ██████████░░░░░░░░░░ 50%");
  // One chart over sources and installed hosts, since a flat source chart says nothing.
  expect(md).toContain("xychart-beta");
  expect(md).toContain('x-axis ["Caveman", "omp"]');
  expect(md).toContain("bar [50, 75]");
  // No drift, so no second chart.
  expect(md.match(/xychart-beta/g)).toHaveLength(1);
  expect(md).toContain("checked 2026-01-02 03:04:05 UTC");
});

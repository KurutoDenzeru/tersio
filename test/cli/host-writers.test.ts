import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOSTS, hasStaticHook, isOwnPath, SHARED_SKILL_DIRS, type AgentHost } from "../../cli/agent-hosts.ts";
import {
  HOOK_MARKER,
  HOOK_SCRIPT_NAME,
  isMarkedEntry,
  mergeHookConfig,
  planAll,
  planHost,
  removeFromHookConfig,
  renderSkill,
  skillDirName,
} from "../../cli/host-writers.ts";
import { START, END } from "../../cli/rules-pack.ts";

const HOME = "/home/tester";
const REWRITTEN = "rtk git status";

/** Hosts that get a static hook file, i.e. the ones we can actually execute. */
const STATIC_HOOK_HOSTS = HOSTS.filter(hasStaticHook);

/** A host with a real rewriter, for tests that do not iterate. omp has none. */
const SAMPLE_HOST = STATIC_HOOK_HOSTS[0];

/** Builds the stdin payload a host would send, from its own declared inputPath. */
function payloadFor(host: AgentHost, command: string, index = 0): Record<string, unknown> {
  const cfg = host.rewriteConfig!;
  const dotted = Array.isArray(cfg.inputPath) ? cfg.inputPath[index] : cfg.inputPath;
  const keys = dotted.split(".");
  const root: Record<string, unknown> = {};
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const child: Record<string, unknown> = {};
    node[key] = child;
    node = child;
  }
  node[keys[keys.length - 1]] = command;
  return root;
}

interface Sandbox {
  dir: string;
  binDir: string;
  cleanup: () => void;
}

function sandbox(): Sandbox {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-hosts-"));
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  return { dir, binDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Installs a fake `rtk` on PATH. `body` is the shell it runs. */
function fakeRtk(box: Sandbox, body: string): void {
  const bin = path.join(box.binDir, "rtk");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(bin, 0o755);
}

function runRewriter(
  box: Sandbox,
  script: string,
  payload: unknown,
  opts: { isolatePath?: boolean } = {},
): { stdout: string; status: number | null } {
  // `isolatePath` strips the real PATH so a locally installed rtk cannot be
  // found — the "rtk is missing" case has to be genuine, not incidental.
  const pathValue = opts.isolatePath ? box.binDir : `${box.binDir}:${process.env.PATH ?? ""}`;
  const result = spawnSync(process.execPath, [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, PATH: pathValue },
  });
  return { stdout: String(result.stdout ?? ""), status: result.status };
}

function scriptFor(host: AgentHost): string {
  const plan = planHost(host, HOME);
  const artifact = plan.artifacts.find((a) => a.kind === "hook-script");
  if (!artifact) throw new Error(`${host.id} produced no rewriter script`);
  return artifact.content;
}

test("the static-hook host set is the two with a documented input rewrite", () => {
  expect(STATIC_HOOK_HOSTS.map((h) => h.id).toSorted()).toEqual([
    "claude-code",
    "codex",
  ]);
});

// One case per host, so a protocol regression names the host that broke rather
// than failing an anonymous loop iteration.
for (const host of STATIC_HOOK_HOSTS) {
  test(`${host.id} rewrites a command and returns its own wire protocol`, () => {
    const box = sandbox();
    try {
      const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
      writeFileSync(scriptPath, scriptFor(host));
      // rtk rewrite exits 3 on success, which is the trap this guards.
      fakeRtk(box, `printf '%s\\n' '${REWRITTEN}'\nexit 3`);

      const { stdout, status } = runRewriter(box, scriptPath, payloadFor(host, "git status"));
      expect(status, `hook exited ${status}: ${stdout}`).toBe(0);
      expect(stdout.trim(), "rewriter produced no output").not.toBe("");

      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      switch (host.rewriteConfig!.protocol) {
        case "hookSpecificOutput-updatedInput": {
          const specific = parsed.hookSpecificOutput as Record<string, unknown>;
          expect(specific.permissionDecision).toBe("allow");
          expect(specific.hookEventName).toBe(host.rewriteConfig!.event);
          expect((specific.updatedInput as Record<string, unknown>).command).toBe(REWRITTEN);
          break;
        }
      }
    } finally {
      box.cleanup();
    }
  });

  test(`${host.id} leaves the command alone when rtk has no rewrite`, () => {
    const box = sandbox();
    try {
      const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
      writeFileSync(scriptPath, scriptFor(host));
      fakeRtk(box, "exit 0");

      const { stdout, status } = runRewriter(box, scriptPath, payloadFor(host, "git status"));
      expect(status).toBe(0);
      expect(stdout.trim(), "emitted a rewrite with nothing to say").toBe("");
    } finally {
      box.cleanup();
    }
  });

  test(`${host.id} leaves the command alone when rtk is missing entirely`, () => {
    const box = sandbox();
    try {
      const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
      writeFileSync(scriptPath, scriptFor(host));
      // No fakeRtk call: an isolated PATH means the locally installed rtk is
      // unreachable, so `spawnSync` genuinely fails.
      const { stdout, status } = runRewriter(box, scriptPath, payloadFor(host, "git status"), { isolatePath: true });
      expect(status, "a missing rtk must not block the tool").toBe(0);
      expect(stdout.trim()).toBe("");
    } finally {
      box.cleanup();
    }
  });
}

test("every static hook declares a single spelling for the command field", () => {
  // Grok was the only host forwarding both toolInput and tool_input, and it is
  // no longer supported. A multi-path inputPath is now a gap in coverage, not a
  // documented requirement, so assert the simpler contract holds.
  for (const host of STATIC_HOOK_HOSTS) {
    expect(Array.isArray(host.rewriteConfig!.inputPath), `${host.id} accepts two spellings`).toBe(false);
  }
});

test("an rtk failure with a non-zero exit and no output fails open", () => {
  const host = SAMPLE_HOST;
  const box = sandbox();
  try {
    const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
    writeFileSync(scriptPath, scriptFor(host));
    fakeRtk(box, "exit 1");
    const { stdout, status } = runRewriter(box, scriptPath, payloadFor(host, "git status"));
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  } finally {
    box.cleanup();
  }
});

test("malformed stdin fails open instead of throwing", () => {
  const host = SAMPLE_HOST;
  const box = sandbox();
  try {
    const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
    writeFileSync(scriptPath, scriptFor(host));
    fakeRtk(box, `printf '%s\\n' '${REWRITTEN}'`);
    for (const bad of ["", "not json", "[]", "null", '{"unrelated":true}']) {
      const { stdout, status } = runRewriter(box, scriptPath, bad);
      expect(status, `status for ${JSON.stringify(bad)}`).toBe(0);
      expect(stdout.trim(), `wrote output for ${JSON.stringify(bad)}`).toBe("");
    }
  } finally {
    box.cleanup();
  }
});

test("a command rtk would not change is not rewritten", () => {
  const host = SAMPLE_HOST;
  const box = sandbox();
  try {
    const scriptPath = path.join(box.dir, HOOK_SCRIPT_NAME);
    writeFileSync(scriptPath, scriptFor(host));
    // rtk echoes the same command back, so there is nothing to substitute.
    fakeRtk(box, "printf '%s\\n' 'git status'");
    const { stdout, status } = runRewriter(box, scriptPath, payloadFor(host, "git status"));
    expect(status).toBe(0);
    expect(stdout.trim(), "rewrote a command with itself").toBe("");
  } finally {
    box.cleanup();
  }
});

test("the rewriter never blocks the tool, whatever rtk does", () => {
  // The script must exit 0 on every path: a non-zero exit is how a host
  // configured to fail closed would BLOCK the tool call.
  const box = sandbox();
  try {
    for (const host of STATIC_HOOK_HOSTS) {
      const scriptPath = path.join(box.dir, `${host.id}-${HOOK_SCRIPT_NAME}`);
      writeFileSync(scriptPath, scriptFor(host));
      fakeRtk(box, "exit 9");
      const { status } = runRewriter(box, scriptPath, payloadFor(host, "git status"));
      expect(status, `${host.id} exited ${status}; a fail-closed host would block the tool`).toBe(0);
    }
  } finally {
    box.cleanup();
  }
});

// --- rules merging ---------------------------------------------------------

test("the rules block is created, then replaced in place without touching the user's text", () => {
  const host = HOSTS.find((h) => h.id === "claude-code")!;
  const first = planHost(host, HOME).artifacts.find((a) => a.kind === "rules")!;
  expect(first.content.startsWith(START)).toBe(true);
  expect(first.content.trimEnd().endsWith(END)).toBe(true);

  const withUser = `# My project\n\nKeep this line.\n\n${first.content}`;
  const second = planHost(host, HOME, { rulesFile: withUser }).artifacts.find((a) => a.kind === "rules")!;
  expect(second.content).toContain("Keep this line.");
  expect(second.content).toContain("My project");
  // Re-running must not stack blocks.
  expect(second.content.split(START).length - 1).toBe(1);
  expect(second.content).toBe(
    planHost(host, HOME, { rulesFile: second.content }).artifacts.find((a) => a.kind === "rules")!.content,
  );
});

test("a user's unmarked file is appended to, never overwritten", () => {
  const host = HOSTS.find((h) => h.id === "codex")!;
  const existing = "# House rules\n\nAlways run bun run test.\n";
  const artifact = planHost(host, HOME, { rulesFile: existing }).artifacts.find((a) => a.kind === "rules")!;
  expect(artifact.content.startsWith(existing)).toBe(true);
  expect(artifact.content).toContain("Always run bun run test.");
});

test("every rules artifact merges between markers rather than owning the file", () => {
  // Cursor was the only host with a dedicated rule file needing frontmatter.
  // With it gone, every supported host merges into a file the user also writes
  // to, so a whole-file write would clobber their content.
  for (const host of HOSTS) {
    for (const artifact of planHost(host, HOME).artifacts.filter((a) => a.kind === "rules")) {
      expect(artifact.merge, `${host.id} would overwrite the user's rules file`).toBe("block");
      expect(artifact.content, `${host.id} rules are unmarked`).toContain(START);
    }
  }
});

test("a host with a real hook gets the automatic-rewrite wording", () => {
  const host = HOSTS.find((h) => h.id === "claude-code")!;
  const rules = planHost(host, HOME).artifacts.find((a) => a.kind === "rules")!;
  expect(rules.content).toContain("filters output before the model reads it");
  expect(rules.content).not.toContain("prefix noisy commands");
});

// --- skills ----------------------------------------------------------------

test("each skills host gets three skills whose name matches the directory", () => {
  const noGenericSkills = new Set(["omp", "opencode"]);
  for (const host of HOSTS) {
    const skills = planHost(host, HOME).artifacts.filter((a) => a.kind === "skill");
    // omp gets skills from its own plugin; opencode documents none globally.
    if (!host.skills || isOwnPath(host) || noGenericSkills.has(host.id)) {
      expect(skills, `${host.id} should get no generic skills`).toHaveLength(0);
      continue;
    }
    expect(skills.map((s) => path.basename(path.dirname(s.absPath))).toSorted(), host.id)
      .toEqual(["tersio-caveman", "tersio-ponytail", "tersio-rtk"]);
    for (const skill of skills) {
      const dirName = path.basename(path.dirname(skill.absPath));
      expect(skill.content, `${host.id}/${dirName} name must match its directory`).toContain(`name: ${dirName}`);
      expect(skill.content, `${host.id}/${dirName} needs a description`).toMatch(/^description: .+/m);
      expect(skill.absPath.endsWith("SKILL.md")).toBe(true);
    }
  }
});

test("skill files carry no HTML markers, because Hermes scans for injection patterns", () => {
  // Hermes drops a whole context file that trips its prompt-injection scan, and
  // an HTML comment is exactly the shape that trips it.
  for (const host of HOSTS) {
    for (const skill of planHost(host, HOME).artifacts.filter((a) => a.kind === "skill")) {
      expect(skill.content, `${host.id} skill has an HTML comment marker`).not.toContain("<!--");
      expect(skill.merge).toBe("whole");
    }
  }
});

test("the caveman skill states the level names it can switch to", () => {
  const skill = renderSkill("caveman", "desc", "body");
  expect(skill).toContain("name: tersio-caveman");
  expect(skillDirName("ponytail")).toBe("tersio-ponytail");
});

// --- hook config merging ---------------------------------------------------

test("a user's own hook survives install and reinstall", () => {
  const host = HOSTS.find((h) => h.id === "claude-code")!;
  const existing = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
    },
  });
  const first = planHost(host, HOME, { hookConfig: existing }).artifacts.find((a) => a.kind === "hook-config")!;
  const parsed = JSON.parse(first.content) as Record<string, any>;
  const entries = parsed.hooks.PreToolUse;
  expect(entries, "the user's own PreToolUse hook was dropped").toHaveLength(2);
  expect(JSON.stringify(entries)).toContain("echo mine");
  expect(parsed.hooks.Stop, "an unrelated event was dropped").toBeDefined();

  // Reinstall must replace ours rather than accumulate copies.
  const second = planHost(host, HOME, { hookConfig: first.content }).artifacts.find((a) => a.kind === "hook-config")!;
  const reparsed = JSON.parse(second.content) as Record<string, any>;
  expect(reparsed.hooks.PreToolUse).toHaveLength(2);
  expect(second.content).toBe(first.content);
});

test("our entry is recognisable by marker and by script path", () => {
  expect(isMarkedEntry({ name: HOOK_MARKER })).toBe(true);
  expect(isMarkedEntry({ hooks: [{ command: `node /x/${HOOK_SCRIPT_NAME}` }] })).toBe(true);
  expect(isMarkedEntry({ hooks: [{ command: "node /x/other.mjs" }] })).toBe(false);
  expect(isMarkedEntry("nope")).toBe(false);
  expect(isMarkedEntry(null)).toBe(false);
});

test("a corrupt hook config is replaced rather than half-merged", () => {
  const ours = JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ name: HOOK_MARKER, command: "x" }] }] } });
  expect(mergeHookConfig("{ not json", ours, "PreToolUse")).toBe(ours);
  expect(mergeHookConfig(null, ours, "PreToolUse")).toBe(ours);
  expect(mergeHookConfig("[]", ours, "PreToolUse")).toBe(ours);
});

test("uninstall removes only our entry", () => {
  const withBoth = JSON.stringify({
    version: 1,
    hooks: {
      preToolUse: [
        { matcher: "Shell", hooks: [{ type: "command", command: "echo mine" }] },
        { matcher: "Shell", hooks: [{ name: HOOK_MARKER, type: "command", command: `node /x/${HOOK_SCRIPT_NAME}` }] },
      ],
    },
  });
  const after = JSON.parse(removeFromHookConfig(withBoth, "preToolUse")) as Record<string, any>;
  expect(after.hooks.preToolUse).toHaveLength(1);
  expect(JSON.stringify(after)).toContain("echo mine");
  expect(JSON.stringify(after)).not.toContain(HOOK_MARKER);
});

test("removing the last entry drops the event key instead of leaving an empty array", () => {
  const only = JSON.stringify({ hooks: { preToolUse: [{ matcher: "Shell", hooks: [{ name: HOOK_MARKER, command: "x" }] }] } });
  const after = JSON.parse(removeFromHookConfig(only, "preToolUse")) as Record<string, unknown>;
  expect(after.hooks).toBeUndefined();
});

test("removal is a no-op when our entry was never there", () => {
  const theirs = JSON.stringify({ hooks: { preToolUse: [{ matcher: "Shell", hooks: [{ command: "echo mine" }] }] } });
  expect(removeFromHookConfig(theirs, "preToolUse")).toBe(theirs);
});

// --- plan invariants -------------------------------------------------------

test("a host with no documented rewrite gets no hook file at all", () => {
  for (const host of HOSTS.filter((h) => !h.rewrite)) {
    const plan = planHost(host, HOME);
    expect(plan.rewriteInstalled, `${host.id} claims a hook it cannot use`).toBe(false);
    expect(plan.artifacts.filter((a) => a.kind === "hook-config" || a.kind === "hook-script"), host.id)
      .toHaveLength(0);
  }
});

test("a live-extension host gets no static hook, only its rules and skills", () => {
  for (const id of ["omp", "opencode", "pi"]) {
    const plan = planHost(HOSTS.find((h) => h.id === id)!, HOME);
    expect(plan.liveExtension, `${id} should be a live-extension host`).toBe(true);
    expect(plan.rewriteInstalled, `${id} must not get a static hook`).toBe(false);
    expect(plan.artifacts.filter((a) => a.kind === "hook-script"), id).toHaveLength(0);
  }
});

test("every host's rules promise the automatic rewrite, because none is guidance-only", () => {
  // With every supported host either hook-driven or extension-driven, no row may
  // claim guidance-only. This is the inverse of the removed pending-host test:
  // if a future host has no rewrite surface, this fails and the wording needs
  // revisiting.
  for (const host of HOSTS) {
    const plan = planHost(host, HOME);
    expect(plan.guidanceOnly, `${host.id} regressed to guidance-only`).toBe(false);
    for (const artifact of plan.artifacts) {
      if (artifact.kind !== "rules") continue;
      expect(artifact.content, `${host.id} rules do not promise automation`)
        .toContain("filters output before the model reads it");
    }
  }
});

test("every planned artifact has an absolute path", () => {
  for (const plan of planAll(HOME)) {
    for (const artifact of plan.artifacts) {
      expect(path.isAbsolute(artifact.absPath), `${plan.host.id} ${artifact.kind} path is relative`).toBe(true);
      expect(artifact.content.length, `${plan.host.id} ${artifact.kind} is empty`).toBeGreaterThan(0);
    }
  }
});

test("no two hosts write to the same path for the same artifact kind", () => {
  const seen = new Map<string, string>();
  for (const plan of planAll(HOME)) {
    // A shared skills root is covered by the agreement test below instead.
    const shared = plan.host.skillsDir !== null && SHARED_SKILL_DIRS.has(plan.host.skillsDir);
    for (const artifact of plan.artifacts) {
      if (shared && artifact.kind === "skill") continue;
      const key = `${artifact.kind}:${artifact.absPath}`;
      const owner = seen.get(key);
      expect(owner, `${plan.host.id} and ${owner} both write ${key}`).toBeUndefined();
      seen.set(key, plan.host.id);
    }
  }
});

test("hosts sharing a skills root emit byte-identical skills", () => {
  // Codex and OpenClaw both use the shared .agents convention, so they write
  // the same files. A divergence would mean one host gets different mode text.
  const byPath = new Map<string, string>();
  for (const plan of planAll(HOME)) {
    if (plan.host.skillsDir === null || !SHARED_SKILL_DIRS.has(plan.host.skillsDir)) continue;
    for (const skill of plan.artifacts.filter((a) => a.kind === "skill")) {
      const existing = byPath.get(skill.absPath);
      if (existing !== undefined) {
        expect(skill.content, `${plan.host.id} disagrees with an earlier host on ${skill.absPath}`).toBe(existing);
      }
      byPath.set(skill.absPath, skill.content);
    }
  }
  expect(byPath.size, "expected at least one shared skill to compare").toBeGreaterThan(0);
});

test("a shared skills root never promises an automatic rewrite", () => {
  // Codex can auto-rewrite and OpenClaw cannot, but they share one file. The
  // text must be the safe superset, or whichever host installed last decides
  // what the other host promises.
  for (const plan of planAll(HOME)) {
    if (plan.host.skillsDir === null || !SHARED_SKILL_DIRS.has(plan.host.skillsDir)) continue;
    for (const skill of plan.artifacts.filter((a) => a.kind === "skill")) {
      expect(skill.content, `${plan.host.id} shared skill promises automation`)
        .toContain("prefix noisy commands");
      expect(skill.content, `${plan.host.id} shared skill promises automation`)
        .not.toContain("filters output before the model reads it");
    }
  }
});

test("a host with a private skills dir keeps its own auto-rewrite wording", () => {
  const host = HOSTS.find((h) => h.id === "claude-code")!;
  for (const skill of planHost(host, HOME).artifacts.filter((a) => a.kind === "skill")) {
    expect(skill.content).toContain("filters output before the model reads it");
  }
});

test("the hook config points at the rewriter script we actually generate", () => {
  for (const host of STATIC_HOOK_HOSTS) {
    const plan = planHost(host, HOME);
    const script = plan.artifacts.find((a) => a.kind === "hook-script")!;
    const config = plan.artifacts.find((a) => a.kind === "hook-config")!;
    expect(config.content, `${host.id} config does not reference its script`)
      .toContain(script.absPath);
    expect(script.absPath.endsWith(HOOK_SCRIPT_NAME)).toBe(true);
  }
});

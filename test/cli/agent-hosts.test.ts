import { expect, test } from "vitest";
import path from "node:path";
import { HOSTS, byId, hasStaticHook, isGuidanceOnly, isLiveExtension, isOwnPath, hostPath } from "../../cli/agent-hosts.ts";

// The registry is the single source of truth for nine hosts, so most of these
// are invariant checks: they fail when someone adds a host with a half-filled
// entry, which is cheaper to catch here than in a user's home directory.

test("every host id is unique and kebab-case", () => {
  const ids = HOSTS.map((h) => h.id);
  expect(new Set(ids).size, `duplicate ids: ${ids.join(", ")}`).toBe(ids.length);
  for (const id of ids) {
    expect(id, `not kebab-case: ${id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test("every host is fully populated", () => {
  for (const host of HOSTS) {
    expect(host.label.length, `${host.id} has no label`).toBeGreaterThan(0);
    expect(host.configDir.length, `${host.id} has no configDir`).toBeGreaterThan(0);
    expect(host.binaries.length, `${host.id} probes no binary`).toBeGreaterThan(0);
    for (const binary of host.binaries) {
      expect(binary.trim(), `${host.id} has a blank binary name`).not.toBe("");
      expect(binary, `${host.id} binary must not contain a path separator`).not.toMatch(/[\\/]/);
    }
    expect(host.source, `${host.id} has no source`).toMatch(/^https:\/\//);
  }
});

// Hosts with no global skills location, so the generic emitters write none for
// them. omp is own-path (its plugin owns its skills); opencode documents skills
// only at project scope (`.opencode/skills/`), with no global directory.
const NO_GENERIC_SKILLS = new Set(["omp", "opencode"]);

test("rules and skills flags agree with the paths they claim", () => {
  for (const host of HOSTS) {
    // An own-path host (omp) legitimately leaves both null: a wiring module
    // writes its instruction file and skills. Anywhere else, a null path
    // beside a true flag is a half-filled entry.
    const own = isOwnPath(host);
    if (own) {
      expect(host.rulesFile, `${host.id} is own-path but names a rulesFile`).toBeNull();
      expect(host.skillsDir, `${host.id} is own-path but names a skillsDir`).toBeNull();
    }
    if (host.rules && !own) {
      expect(host.rulesFile, `${host.id} claims rules but has no rulesFile`).toBeTruthy();
    } else if (!host.rules) {
      expect(host.rulesFile, `${host.id} has no rules but names a rulesFile`).toBeNull();
    }
    if (host.skills && !own && !NO_GENERIC_SKILLS.has(host.id)) {
      expect(host.skillsDir, `${host.id} claims skills but has no skillsDir`).toBeTruthy();
    } else if (!host.skills) {
      expect(host.skillsDir, `${host.id} has no skills but names a skillsDir`).toBeNull();
    }
    for (const p of [host.rulesFile, host.skillsDir]) {
      if (p) expect(p, `${host.id} path must be $HOME-relative`).toMatch(/^\.[^/]/);
    }
  }
});

test("a rewrite-capable host either has a hook config or names its owner", () => {
  // Structural, not prose: a host with no static hook file must point at the
  // module that writes one, so doctor can report it and silence cannot ship.
  for (const host of HOSTS) {
    if (!host.rewrite) {
      expect(host.rewriteOwner, `${host.id} cannot rewrite at all, so it owns nothing`).toBeUndefined();
      continue;
    }
    if (host.rewriteConfig) {
      expect(host.rewriteOwner, `${host.id} has a static hook and needs no owner`).toBeUndefined();
      continue;
    }
    expect(
      host.rewriteOwner,
      `${host.id} can rewrite but has neither a hook config nor a rewriteOwner`,
    ).toBeDefined();
  }
});

test("the wired live-extension hosts are omp, opencode, and pi", () => {
  const owned = HOSTS.filter(isLiveExtension).map((h) => `${h.id}:${h.rewriteOwner}`).toSorted();
  expect(owned).toEqual(["omp:wiring", "opencode:plugin", "pi:wiring"]);
});

test("opencode ships its own plugin, because rtk's is a pre-v2 shape", () => {
  const opencode = byId("opencode");
  expect(opencode?.rewrite).toBe(true);
  expect(opencode?.rewriteOwner).toBe("plugin");
  expect(isLiveExtension(opencode!)).toBe(true);
  // V2 reads a global AGENTS.md from the config dir.
  expect(opencode?.rulesFile).toBe(".config/opencode/AGENTS.md");
  expect(opencode?.caveats).toMatch(/rtk-ai\/rtk#3463/);
});

test("pi is a live-extension host, wired by rtk's own init", () => {
  const pi = byId("pi");
  expect(pi).toBeDefined();
  expect(isLiveExtension(pi!)).toBe(true);
  expect(hasStaticHook(pi!), "pi gets an extension, not a static hook file").toBe(false);
  expect(isGuidanceOnly(pi!)).toBe(false);
  expect(pi?.rewriteOwner).toBe("wiring");
  expect(pi?.caveats).toMatch(/rtk init -g --agent pi/);
});

test("every live-extension host names its owner", () => {
  for (const host of HOSTS.filter(isLiveExtension)) {
    expect(host.rewriteOwner, `${host.id} is live but names no owner`).toBeDefined();
  }
});

test("no host is guidance-only any more", () => {
  // Every supported host either has a static hook or a named owner, so the
  // guidance-only branch is currently unreachable. If a future host lands with
  // no rewrite surface, this fails and the row wording needs revisiting.
  expect(HOSTS.filter(isGuidanceOnly).map((h) => h.id)).toEqual([]);
});

test("every host ships a working rewrite or says plainly that it does not", () => {
  // The property that matters: no host can claim an auto-rewrite that is not
  // installed. A host is honest if it has a static hook, a wired owner, or no
  // rewrite capability claimed at all.
  for (const host of HOSTS) {
    if (isGuidanceOnly(host)) continue;
    expect(hasStaticHook(host) || isLiveExtension(host), `${host.id} claims a rewrite it does not have`).toBe(true);
  }
});

test("every hook config names a supported format, protocol, event, and input path", () => {
  for (const host of HOSTS) {
    const cfg = host.rewriteConfig;
    if (!cfg) continue;
    expect(["claude-json"], `${host.id} format`).toContain(cfg.configFormat);
    expect(
      ["hookSpecificOutput-updatedInput", "updated_input"],
      `${host.id} protocol`,
    ).toContain(cfg.protocol);
    expect(cfg.event.length, `${host.id} event`).toBeGreaterThan(0);
    expect(cfg.matcher.length, `${host.id} matcher`).toBeGreaterThan(0);
    const paths = Array.isArray(cfg.inputPath) ? cfg.inputPath : [cfg.inputPath];
    for (const p of paths) {
      expect(p, `${host.id} inputPath must be a dotted path`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/);
    }
    expect(cfg.configFile, `${host.id} configFile must be $HOME-relative`).toMatch(/^\.[^/]/);
  }
});

test("every static hook speaks the one wire protocol the registry declares", () => {
  // Claude Code and Codex were the last two hosts sharing this shape. Cursor's
  // flat `updated_input` went with it, so the protocol union is now a single
  // member and a new hook shape has to be added deliberately.
  const protocols = new Set(HOSTS.map((h) => h.rewriteConfig?.protocol).filter(Boolean));
  expect([...protocols].toSorted()).toEqual(["hookSpecificOutput-updatedInput"]);
});

test("a fail-closed host is deliberate, since a broken rewriter would block the tool", () => {
  for (const host of HOSTS) {
    if (host.rewriteConfig?.failClosed) {
      expect(
        host.caveats ?? "",
        `${host.id} is failClosed but its caveat does not mention the failure mode`,
      ).toMatch(/fail|error|timeout|block/i);
    }
  }
});

test("Gemini CLI stays out of the registry", () => {
  // Sunset for free/Pro/Ultra accounts on 2026-06-18. Re-adding it, or its
  // Antigravity CLI successor, needs an explicit decision, not an accident.
  expect(byId("gemini-cli")).toBeUndefined();
  expect(byId("agy")).toBeUndefined();
});

test("the registry holds exactly the five documented hosts", () => {
  expect(HOSTS.map((h) => h.id).toSorted()).toEqual([
    "claude-code",
    "codex",
    "omp",
    "opencode",
    "pi",
  ]);
});

test("no host probes a bare cmd, which would hit the Windows shell", () => {
  // Command Code was the only host with a `cmd` binary; it is no longer
  // supported. This stays as a guard so a future host cannot reintroduce a
  // probe that resolves to cmd.exe on Windows.
  for (const host of HOSTS) {
    expect(host.binaries, `${host.id} probes the bare cmd`).not.toContain("cmd");
  }
});

test("hostPath is $HOME-relative when no relocation env var is set", () => {
  const host = byId("claude-code")!;
  expect(hostPath(host, ".claude/settings.json", "/home/u")).toBe(path.join("/home/u", ".claude", "settings.json"));
});

test("a relocation env var moves only paths inside the config dir", () => {
  const host = byId("codex")!;
  process.env.CODEX_HOME = "/opt/codex";
  try {
    // Inside the config dir, so it moves.
    expect(hostPath(host, ".codex/hooks.json", "/home/u")).toBe(path.join("/opt/codex", "hooks.json"));
    expect(hostPath(host, ".codex", "/home/u")).toBe("/opt/codex");
    // A shared-convention path outside the config dir belongs to the home dir
    // and must not move, or Codex skills would break under CODEX_HOME.
    expect(hostPath(host, ".agents/skills", "/home/u")).toBe(path.join("/home/u", ".agents", "skills"));
  } finally {
    delete process.env.CODEX_HOME;
  }
});

test("a blank relocation env var falls back to the home directory", () => {
  const host = byId("pi")!;
  process.env.PI_CODING_AGENT_DIR = "   ";
  try {
    expect(hostPath(host, ".pi/agent/AGENTS.md", "/home/u"))
      .toBe(path.join("/home/u", ".pi", "agent", "AGENTS.md"));
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
  }
});

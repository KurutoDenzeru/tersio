import { expect, test } from "vitest";
import path from "node:path";
import { HOSTS, byId, hasStaticHook, isGuidanceOnly, isLiveExtension, isOwnPath, hostPath } from "../../cli/agent-hosts.ts";

// The registry is the single source of truth for twelve hosts, so most of these
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

test("rules and skills flags agree with the paths they claim", () => {
  for (const host of HOSTS) {
    // An own-path host (omp, opencode) legitimately leaves both null: a wiring
    // module writes its instruction file and skills. Anywhere else, a null path
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
    if (host.skills && !own) {
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

test("the live-extension hosts are exactly the four with a named owner", () => {
  const owned = HOSTS.filter(isLiveExtension).map((h) => `${h.id}:${h.rewriteOwner}`).toSorted();
  expect(owned).toEqual([
    "command-code:mod",
    "omp:wiring",
    "opencode:plugin",
    "pi:wiring",
  ]);
});

test("every hook config names a supported format, protocol, event, and input path", () => {
  for (const host of HOSTS) {
    const cfg = host.rewriteConfig;
    if (!cfg) continue;
    expect(["claude-json", "copilot-json", "cursor-json", "hermes-yaml"], `${host.id} format`).toContain(cfg.configFormat);
    expect(
      ["hookSpecificOutput-updatedInput", "modifiedArgs", "updated_input", "hermes-modify"],
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

test("the four rewrite wire protocols are each represented", () => {
  const protocols = new Set(HOSTS.map((h) => h.rewriteConfig?.protocol).filter(Boolean));
  expect([...protocols].toSorted()).toEqual([
    "hermes-modify",
    "hookSpecificOutput-updatedInput",
    "modifiedArgs",
    "updated_input",
  ]);
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
  // Sunset for free/Pro/Ultra accounts on 2026-06-18; agy is the successor.
  // Re-adding it needs an explicit decision, not an accident.
  expect(byId("gemini-cli")).toBeUndefined();
  expect(byId("agy")).toBeDefined();
  expect(byId("agy")?.source).toContain("antigravity.google");
});

test("the registry holds exactly the twelve documented hosts", () => {
  expect(HOSTS.map((h) => h.id).toSorted()).toEqual([
    "agy",
    "claude-code",
    "codex",
    "command-code",
    "copilot-cli",
    "cursor",
    "grok-build",
    "hermes",
    "omp",
    "openclaw",
    "opencode",
    "pi",
  ]);
});

test("Command Code never probes a bare cmd first, which would hit the Windows shell", () => {
  const host = byId("command-code");
  expect(host).toBeDefined();
  expect(host?.binaries[0], "cmd must not be the first probe").toBe("command-code");
  expect(host?.binaries).toContain("cmd");
  expect(host?.caveats).toMatch(/win32/);
});

test("agy is guidance-only and command-code is a live extension", () => {
  const agy = byId("agy");
  expect(agy).toBeDefined();
  expect(isGuidanceOnly(agy!)).toBe(true);
  expect(hasStaticHook(agy!)).toBe(false);

  const cmd = byId("command-code");
  expect(cmd).toBeDefined();
  expect(isLiveExtension(cmd!)).toBe(true);
  expect(hasStaticHook(cmd!)).toBe(false);
});

test("the two hosts that cannot auto-rewrite are exactly OpenClaw and agy", () => {
  const guidance = HOSTS.filter(isGuidanceOnly).map((h) => h.id).toSorted();
  expect(guidance).toEqual(["agy", "openclaw"]);
});

test("hermes has rules disabled because it has no user-global instruction file", () => {
  const hermes = byId("hermes");
  expect(hermes?.rules).toBe(false);
  expect(hermes?.rulesFile).toBeNull();
  expect(hermes?.skills).toBe(true);
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
  const host = byId("copilot-cli")!;
  process.env.COPILOT_HOME = "   ";
  try {
    expect(hostPath(host, ".copilot/hooks/tersio-rtk.json", "/home/u"))
      .toBe(path.join("/home/u", ".copilot", "hooks", "tersio-rtk.json"));
  } finally {
    delete process.env.COPILOT_HOME;
  }
});

test("agy keeps its rules file outside its own config dir, and says why", () => {
  // Global context is still ~/.gemini/GEMINI.md even though settings moved to
  // ~/.gemini/antigravity-cli — so the path must resolve against $HOME.
  const host = byId("agy")!;
  expect(host.rulesFile).toBe(".gemini/GEMINI.md");
  expect(host.configDir).toBe(".gemini/antigravity-cli");
  expect(hostPath(host, host.rulesFile!, "/home/u")).toBe(path.join("/home/u", ".gemini", "GEMINI.md"));
  expect(host.caveats).toMatch(/GEMINI\.md/);
});

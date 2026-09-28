import { expect, test } from "vitest";
import { HOSTS, byId, REWRITE_WIRING } from "../../cli/agent-hosts.ts";

// Invariant checks: a half-filled registry entry fails here, not in a user's home directory.

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

test("every retired path is $HOME-relative and a path of ours or the user's", () => {
  for (const host of HOSTS) {
    for (const entry of host.retired ?? []) {
      expect(entry.path, `${host.id} retired path must be $HOME-relative`).toMatch(/^\.[^/]/);
      expect(["ours", "merged"], `${host.id} retired kind`).toContain(entry.kind);
    }
  }
});

test("the registry holds exactly the two Pi-family hosts", () => {
  expect(HOSTS.map((h) => h.id).toSorted()).toEqual(["omp", "pi"]);
});

test("the removed hosts are out of the registry", () => {
  // Re-adding one is a deliberate decision about a host's own docs, not a side effect of picking a new one up.
  for (const id of ["claude-code", "codex", "opencode", "gemini-cli", "cursor", "agy"]) {
    expect(byId(id), `${id} is back in the registry`).toBeUndefined();
  }
});

test("omp is never auto-detected, so a selection that dropped it stays dropped", () => {
  expect(byId("omp")?.autoDetect).toBe(false);
  expect(byId("pi")?.autoDetect).toBeUndefined();
});

test("no host probes a bare cmd, which would hit the Windows shell", () => {
  for (const host of HOSTS) {
    expect(host.binaries, `${host.id} probes the bare cmd`).not.toContain("cmd");
  }
});

test("pi's rewrite is rtk's own module, and the caveat says so", () => {
  const pi = byId("pi");
  expect(pi?.caveats).toMatch(/rtk init -g --agent pi/);
  expect(pi?.configDirEnv).toBe("PI_CODING_AGENT_DIR");
  expect(pi?.nativeInstall?.command).toBe("pi install npm:@krtclcdy/tersio");
});

test("every host reports the same rewrite wiring, because rtk owns it", () => {
  expect(REWRITE_WIRING).toBe("rtk extension · auto-rewrite");
  for (const host of HOSTS) {
    expect(host.caveats, `${host.id} says nothing about the rewrite`).toMatch(/rtk/);
  }
});

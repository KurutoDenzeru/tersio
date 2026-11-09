import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cavemanSessionExtension from '../../extensions/caveman/index.ts';
import comboToggleExtension, { ponytailFallback } from '../../extensions/combo/index.ts';
import pstackSessionExtension from '../../extensions/pstack/index.ts';
import {
  deriveLevel,
  getSharedComboState,
  isComboPresetActive,
  normalizeComboLevel,
  OMP_SUBAGENT_MARKER,
  resetSharedComboState,
  setSharedComboLevel,
  setSharedComboMode,
} from '../../extensions/shared/session-state.ts';
import type { ExtensionApi, ExtensionCtx, SessionEntry } from '../../extensions/shared/types.ts';
import { readCavemanDefault } from '../../extensions/shared/plugin-settings.ts';
import { ruleBodyProblem, ruleDir } from '../../extensions/shared/utils.ts';
import { cliEnv, withHome } from '../helpers/env.ts';

// fileURLToPath, not `.pathname`: a URL pathname on Windows is `/D:/...`, which path.join doubles into `D:\D:\...`.
process.env.HOME = fileURLToPath(new URL('../definitely-missing-home/modes', import.meta.url));
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
}

interface TestCtx {
  notifications: string[];
  statuses: Map<string, string>;
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { setStatus(name: string, value: string | undefined): void; notify(message: string): void };
}

/** A pi-flavoured harness (no zod) whose `systemPromptOptions` surface proves the pi inject path. */
function piHarness(entries: SessionEntry[] = []): { pi: TestPi; ctx: TestCtx } {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  const statuses = new Map<string, string>();
  cavemanSessionExtension({
    setLabel() {},
    registerCommand(name: string, config: { handler: CommandHandler }) {
      commands.set(name, config.handler);
    },
    registerTool() {},
    appendEntry(customType: string, data: Record<string, unknown>) {
      entries.push({ type: 'custom', customType, data });
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    notifications,
    statuses,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus(name: string, v: string | undefined) {
        if (v !== undefined) {
          statuses.set(name, v);
          if (name === 'tersio') notifications.push(v);
        }
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
  };
  return { pi: { commands, handlers }, ctx: ctx as TestCtx };
}

function harness(entries: SessionEntry[] = []): { pi: TestPi; ctx: TestCtx } {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  // setStatus is keyed: notifications mirrors the combo-line assertions, statuses keeps every key.
  const statuses = new Map<string, string>();
  cavemanSessionExtension({
    // The injected zod is how the extensions recognise an OMP host.
    zod: { z: {} },
    setLabel() {},
    registerCommand(name: string, config: { handler: CommandHandler }) {
      commands.set(name, config.handler);
    },
    registerTool() {},
    appendEntry(customType: string, data: Record<string, unknown>) {
      entries.push({ type: 'custom', customType, data });
    },
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    notifications,
    statuses,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus(name: string, v: string | undefined) {
        if (v !== undefined) {
          statuses.set(name, v);
          if (name === 'tersio') notifications.push(v);
        }
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
  };
  return { pi: { commands, handlers }, ctx: ctx as TestCtx };
}

async function caveman(entries: SessionEntry[], arg: string): Promise<string[]> {
  resetSharedComboState();
  const { pi, ctx } = harness(entries);
  await pi.commands.get('caveman')!(arg, ctx);
  return ctx.notifications;
}

test('bare /caveman and /caveman on enable full', async () => {
  for (const arg of ['', 'on']) {
    const notifications = await caveman([], arg);
    expect(notifications.at(-1)).toMatch(/🧩 CUSTOM | 🪨 caveman:FULL/);
  }
});

test('each mode reports itself in the shared status line', async () => {
  for (const mode of ['lite', 'ultra', 'megacave-lite', 'megacave-full', 'megacave-ultra']) {
    const notifications = await caveman([], mode);
    expect(notifications.at(-1)).toMatch(new RegExp(`🪨 caveman:${mode.toUpperCase()} `));
  }
  for (const legacy of ['wenyan', 'wenyan-full']) {
    const notifications = await caveman([], legacy);
    expect(notifications.at(-1)).toMatch(/🪨 caveman:MEGACAVE-FULL /);
  }
});

test('turning caveman off collapses the status to the off line', async () => {
  const notifications = await caveman([], 'off');
  expect(notifications.at(-1)).toBe('🧩 OFF');
});

test('status reports the current mode, unknown args show usage', async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get('caveman')!('ultra', ctx);
  expect(ctx.notifications.at(-1)).toMatch(/🪨 caveman:ULTRA/);
  await pi.commands.get('caveman')!('status', ctx);
  expect(ctx.notifications.at(-1)).toBe('Caveman mode: ultra');
  await pi.commands.get('caveman')!('bogus', ctx);
  expect(ctx.notifications.at(-1)).toBe(
    'Usage: /caveman [lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|off|status]',
  );
});

test('natural-language off commands switch the mode off', async () => {
  for (const text of ['stop caveman', 'Normal mode!', 'caveman off']) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get('caveman')!('full', ctx);
    await pi.handlers.get('input')!({ text, source: 'user' }, ctx);
    expect(ctx.notifications).toContain('🧩 OFF');
    await pi.commands.get('caveman')!('status', ctx);
    expect(ctx.notifications.at(-1)).toBe('Caveman mode: off');
  }
});

test('input from extensions never toggles the mode', async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get('caveman')!('full', ctx);
  await pi.handlers.get('input')!({ text: 'stop caveman', source: 'extension' }, ctx);
  expect(ctx.notifications.at(-1)).toMatch(/🪨 caveman:FULL/);
  await pi.commands.get('caveman')!('status', ctx);
  expect(ctx.notifications.at(-1)).toBe('Caveman mode: full');
});

test('session_start restores the persisted mode, fresh sessions use the default', async () => {
  resetSharedComboState();
  const restored = harness([{ type: 'custom', customType: 'caveman-mode', data: { mode: 'wenyan' } }]);
  await restored.pi.handlers.get('session_start')!({}, restored.ctx);
  // A session entry written under the old name restores onto the canonical one.
  expect(restored.ctx.notifications.at(-1)).toMatch(/🪨 caveman:MEGACAVE-FULL/);

  resetSharedComboState();
  const fresh = harness();
  await fresh.pi.handlers.get('session_start')!({}, fresh.ctx);
  expect(fresh.ctx.notifications.at(-1)).toBe('🧩 OFF');
});

test('legacy plugin default normalizes to megacave-full and injects rules', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-caveman-default-'));
  const lockDir = path.join(home, '.omp', 'plugins');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(
    path.join(lockDir, 'omp-plugins.lock.json'),
    JSON.stringify({
      settings: { '@krtclcdy/tersio': { cavemanDefault: 'wenyan' } },
    }),
    'utf8',
  );
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TERSIO_HOME: process.env.TERSIO_HOME,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = home;
  try {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.handlers.get('session_start')!({}, ctx);
    // The lookup returns `wenyan` verbatim; the session normalizes it and injects that mode's block.
    expect(readCavemanDefault()).toBe('wenyan');
    const injected = (await pi.handlers.get('before_agent_start')!({ systemPrompt: 'Base.' }, ctx)) as {
      systemPrompt: string[];
    };
    expect(injected.systemPrompt.at(-1)).toMatch(/Caveman megacave-full active/);
    expect(injected.systemPrompt.at(-1)).toMatch(/以文言答/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('a settings write lands on the next read, and the parse is reused until then', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-settings-cache-'));
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TERSIO_HOME: process.env.TERSIO_HOME,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = home;
  const file = path.join(home, 'settings.json');
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify({ cavemanDefault: 'lite' }), 'utf8');
    expect(readCavemanDefault()).toBe('lite');
    // A same-size rewrite lands: Windows reports a coarse mtime, so the text decides, not a stat.
    writeFileSync(file, JSON.stringify({ cavemanDefault: 'full' }), 'utf8');
    expect(readCavemanDefault(), 'a write after a read is visible').toBe('full');
    // A corrupt file is a miss, never a remembered value.
    writeFileSync(file, '{ not json', 'utf8');
    expect(readCavemanDefault()).toBe('off');
    rmSync(file);
    expect(readCavemanDefault(), 'the last good parse is not served for a deleted file').toBe('off');
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('before_agent_start injects the per-mode instruction, nothing when off', async () => {
  for (const [mode, pattern] of [
    ['lite', /Caveman lite active/],
    ['ultra', /Caveman ultra active/],
    ['megacave-full', /Caveman megacave-full active/i],
    ['megacave-lite', /Caveman megacave-lite active/i],
    ['megacave-ultra', /Caveman megacave-ultra active/i],
  ] as const) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get('caveman')!(mode, ctx);
    const result = (await pi.handlers.get('before_agent_start')!({ systemPrompt: 'Base.' }, ctx)) as {
      systemPrompt: string[];
    };
    expect(result.systemPrompt).toHaveLength(2);
    expect(result.systemPrompt.at(-1)).toMatch(pattern);
  }

  resetSharedComboState();
  const { pi, ctx } = harness();
  const result = await pi.handlers.get('before_agent_start')!({ systemPrompt: 'Base.' }, ctx);
  expect(result).toBe(undefined);
});

test('full mode injects the rule file', async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get('caveman')!('full', ctx);
  const result = (await pi.handlers.get('before_agent_start')!({ systemPrompt: 'Base.' }, ctx)) as {
    systemPrompt: string[];
  };
  // The body is the rule file itself, byte for byte, so quoting phrases would pin upstream's wording.
  const rule = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'caveman', 'rule.md'),
    'utf8',
  );
  expect(result.systemPrompt.at(-1)).toBe(`Caveman full active for this session.\n${rule}`);
});

test('each level injects its own rule file verbatim, with no paraphrase alongside it', async () => {
  const extDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'caveman');
  const bodies = {
    lite: 'rule-lite.md',
    full: 'rule.md',
    ultra: 'rule-ultra.md',
    'megacave-lite': 'rule-megacave-lite.md',
    'megacave-full': 'rule-megacave.md',
    'megacave-ultra': 'rule-megacave-ultra.md',
  } as const;
  for (const [mode, file] of Object.entries(bodies)) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get('caveman')!(mode, ctx);
    const result = (await pi.handlers.get('before_agent_start')!({ systemPrompt: 'Base.' }, ctx)) as {
      systemPrompt: string[];
    };

    // One source of truth per level: its rule file, byte for byte.
    const rule = readFileSync(path.join(extDir, file), 'utf8');
    expect(result.systemPrompt.at(-1)).toBe(`Caveman ${mode} active for this session.\n${rule}`);
  }
  // The registers actually differ.
  expect(readFileSync(path.join(extDir, bodies.lite), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies.full), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies.lite), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies.ultra), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies['megacave-lite']), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies['megacave-full']), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies['megacave-ultra']), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies['megacave-full']), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies['megacave-lite']), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies['megacave-ultra']), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies.ultra), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies.full), 'utf8'),
  );
  expect(readFileSync(path.join(extDir, bodies['megacave-full']), 'utf8')).not.toBe(
    readFileSync(path.join(extDir, bodies.full), 'utf8'),
  );
});

test('a missing rule.md names the fix instead of shipping a degraded paraphrase', async () => {
  // A missing rule is a visible failure, not a lossy paraphrase.
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'caveman', 'index.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/FALLBACK_FULL_RULE/);
  expect(source).toMatch(/is missing\. Run: tersio doctor --fix extensions/);
});

// Inline samples, one per pack: the contract each body must keep whatever upstream does.
test('lite keeps articles and full sentences, the way upstream defines the register', () => {
  // Upstream skills/caveman/SKILL.md at 84cc3c1: `lite` is "No filler/hedging. Keep articles + full sentences". Dropping articles and allowing fragments is `full`'s job, so a lite body that does either is the wrong register.
  const lite = readFileSync(path.join(root, 'extensions', 'caveman', 'rule-lite.md'), 'utf8');
  const full = readFileSync(path.join(root, 'extensions', 'caveman', 'rule.md'), 'utf8');

  // The register statement, in upstream's own words where it matters.
  expect(lite).toContain('Keep articles + full sentences');
  expect(lite).toContain('Professional but tight');
  // Lite does not carry the article-dropping or the fragment licence; full does.
  expect(lite).not.toContain('Articles optional');
  expect(lite).not.toContain('Fragments fine');
  expect(full).toContain('Articles optional');
  expect(full).toContain('Fragments fine');
  // Provenance is in the body, so a reader can audit the fork against its source.
  expect(lite).toMatch(/84cc3c1/);
  expect(lite).toMatch(/No filler\/hedging/);
});

test('megacave-lite and megacave-ultra keep the registers upstream assigns them', () => {
  // Upstream skills/caveman/SKILL.md at 84cc3c1: wenyan-lite keeps grammar structure, wenyan-full strips it, wenyan-ultra is "Extreme abbreviation while keeping classical Chinese feel". Three levels, three bodies -- the collapse that left lite loading full's body must not return.
  const lite = readFileSync(path.join(root, 'extensions', 'caveman', 'rule-megacave-lite.md'), 'utf8');
  const ultra = readFileSync(path.join(root, 'extensions', 'caveman', 'rule-megacave-ultra.md'), 'utf8');
  const full = readFileSync(path.join(root, 'extensions', 'caveman', 'rule-megacave.md'), 'utf8');

  // Each names the upstream row it came from.
  expect(lite).toContain('Semi-classical. Drop filler/hedging but keep grammar');
  expect(ultra).toContain('Extreme abbreviation while keeping classical Chinese');
  expect(lite).toMatch(/84cc3c1/);
  expect(ultra).toMatch(/84cc3c1/);
  // Lite keeps grammar; ultra and full do not promise to.
  expect(lite).toContain('Subject, verb, and object stay where a reader expects them');
  // The classical-Chinese floor is shared, so no register loses it.
  for (const body of [lite, ultra, full]) expect(body).toContain('Never cut or translate');
  // Provenance lives in the body, and the register wording is not reused across levels.
  expect(lite).not.toBe(ultra);
  expect(lite).not.toBe(full);
  expect(ultra).not.toBe(full);
});

test('every rule pack passes the body gate and keeps its contract markers', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'caveman');
  const samples: Record<string, string[]> = {
    'rule.md': [
      'Only fluff die',
      'Never drop not/never/no/only/except',
      'Code blocks unchanged',
      'compress the style, not the language',
    ],
    'rule-lite.md': [
      'Keep articles + full sentences',
      'Professional but tight',
      'Never cut: code blocks, commands, paths, API names, error strings (verbatim)',
      'Kill ceremony',
    ],
    'rule-megacave-lite.md': [
      'Semi-classical',
      'keep grammar structure',
      'Never cut or translate',
      'Classical flavour, modern grammar',
    ],
    'rule-megacave-ultra.md': [
      'Extreme abbreviation',
      'classical Chinese feel',
      'Never cut or translate',
      'Extreme abbreviation',
    ],
    'rule-ultra.md': [
      'Payload only',
      'Never cut: code, commands, paths, API names, error strings (verbatim)',
      'One word when one word is enough',
      'no arrows',
    ],
    'rule-megacave.md': [
      '以文言答',
      'Never cut or translate: code, commands, paths, API names, error strings',
      'negation (不, 非, 勿, 未, 毋)',
      '文言, not 白話',
    ],
  };
  for (const [file, markers] of Object.entries(samples)) {
    const body = readFileSync(path.join(dir, file), 'utf8');
    expect(ruleBodyProblem(body), `${file} must pass the install-time body gate`).toBeNull();
    for (const marker of markers)
      expect(body.toLowerCase(), `${file} lost "${marker}"`).toContain(marker.toLowerCase());
  }
  // Every register is its own body, so no level silently pays another level's cost.
  const files = Object.keys(samples);
  for (const a of files) {
    for (const b of files) {
      if (a === b) continue;
      expect(readFileSync(path.join(dir, a), 'utf8'), `${a} must differ from ${b}`).not.toBe(
        readFileSync(path.join(dir, b), 'utf8'),
      );
    }
  }
});

test('the body gate rejects the fetches that would poison a rule file', () => {
  expect(ruleBodyProblem('')).toBe('empty body');
  expect(ruleBodyProblem('<!DOCTYPE html>\n<html><body>oops</body></html>')).toMatch(/HTML page/);
  expect(ruleBodyProblem('404: Not Found')).toMatch(/404/);
  expect(ruleBodyProblem('# Heading\n\nshort')).toMatch(/truncated/);
});

test('the footer carries one line, and a status request answers with the mode', async () => {
  resetSharedComboState();
  const { pi, ctx } = harness([]);
  await pi.commands.get('caveman')!('ultra', ctx);
  expect(ctx.statuses.get('caveman')).toBeUndefined();
  expect(ctx.statuses.get('tersio')).toMatch(/🧩 CUSTOM | 🪨 caveman:ULTRA/);

  await pi.commands.get('caveman')!('status', ctx);
  expect(ctx.statuses.get('caveman')).toBeUndefined();
  expect(ctx.notifications.at(-1)).toBe('Caveman mode: ultra');

  await pi.commands.get('caveman')!('off', ctx);
  expect(ctx.statuses.get('caveman')).toBeUndefined();
  expect(ctx.statuses.get('tersio')).toBe('🧩 OFF');

  await pi.commands.get('caveman')!('status', ctx);
  expect(ctx.notifications.at(-1)).toBe('Caveman mode: off');
});

// pi has no zod, routing it through a different inject path; nothing asserted the rule body reaches it.
test('a pi host receives the rule body through its own inject path', async () => {
  const { pi, ctx } = piHarness();
  await pi.commands.get('caveman')!('full', ctx);

  const rule = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'caveman', 'rule.md'),
    'utf8',
  );

  // pi adapter writes a named section when one is offered.
  const sections: Record<string, string> = {};
  await pi.handlers.get('before_agent_start')!({ systemPromptOptions: { sections, appendSystemPrompt: '' } }, ctx);
  const injected = Object.values(sections).join('\n');
  expect(injected).toContain(`Caveman full active for this session.\n${rule}`);

  // With no sections it appends to the prompt string, keeping what was already there.
  const options = { appendSystemPrompt: 'Base.' };
  await pi.handlers.get('before_agent_start')!({ systemPromptOptions: options }, ctx);
  expect(options.appendSystemPrompt).toContain(`Caveman full active for this session.\n${rule}`);
  expect(options.appendSystemPrompt.startsWith('Base.\n\n')).toBe(true);
});

type ponytailEventHandler = (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>;

function injectHandler(): ponytailEventHandler {
  let handler!: ponytailEventHandler;
  comboToggleExtension({
    // The injected zod is how the extensions recognise an OMP host.
    zod: { z: {} },
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, h: ponytailEventHandler) {
      if (event === 'before_agent_start') handler = h;
    },
  } as unknown as ExtensionApi);
  return handler;
}

async function injectMarked(ponytail: string): Promise<string> {
  resetSharedComboState();
  setSharedComboMode('ponytail', ponytail);
  const result = await injectHandler()({ systemPrompt: `Base.\n${OMP_SUBAGENT_MARKER}` }, undefined);
  const prompt = (result as { systemPrompt?: string[] } | undefined)?.systemPrompt;
  return prompt?.at(-1) ?? '';
}

test('a marked subagent prompt gets the installed ponytail instructions', async () => {
  // Ponytail is a Tersio dependency, so the package resolves beside the extension in every install layout.
  expect(await injectMarked('ultra')).toMatch(/# Ponytail/);
  expect(await injectMarked('ultra')).toMatch(/PONYTAIL MODE ACTIVE — level: ultra/);
});

test('existing ponytail guidance is not duplicated', async () => {
  resetSharedComboState();
  setSharedComboMode('ponytail', 'ultra');
  const result = await injectHandler()(
    { systemPrompt: [OMP_SUBAGENT_MARKER, 'PONYTAIL MODE ACTIVE — level: ultra'] },
    undefined,
  );
  expect(result).toBe(undefined);
});

test('review is not a runtime mode', async () => {
  expect(await injectMarked('review')).toBe('');
});

async function inject(prompt: string): Promise<string | undefined> {
  const result = await injectHandler()({ systemPrompt: prompt }, undefined);
  return (result as { systemPrompt?: string[] } | undefined)?.systemPrompt?.at(-1);
}

test('off mode gets no injection, on mode gets it on any turn', async () => {
  resetSharedComboState();
  setSharedComboMode('ponytail', 'off');
  expect(await inject(`Base.\n${OMP_SUBAGENT_MARKER}`)).toBe(undefined);
  expect(await inject('Base.')).toBe(undefined);

  // Main sessions count now: ponytail used to need a subagent marker, so it never fired on the user's turn.
  resetSharedComboState();
  setSharedComboMode('ponytail', 'ultra');
  expect(await inject('Base.')).toMatch(/PONYTAIL MODE ACTIVE/);
  expect(await inject(`Base.\n${OMP_SUBAGENT_MARKER}`)).toMatch(/PONYTAIL MODE ACTIVE/);
});

// The header is the only level-specific text; YAGNI appears in every level.
test("the Ponytail fallback carries the installed package's own level rules", async () => {
  // The fallback only fires when the vendored copy cannot be resolved, so it is the one place our text speaks for Ponytail: its per-level rule must be the package's own, not a paraphrase.
  for (const level of ['lite', 'full', 'ultra'] as const) {
    // The injected body comes from the installed package, so an empty row means the package did not resolve and this test would otherwise compare the fallback against itself.
    const row = (/^\|\s*\*\*\w+\*\*\s*\|([^|]*)/m.exec(await injectMarked(level))?.[1] ?? '').trim();
    expect(row, `ponytail ${level} ships a level row`).not.toBe('');
    expect(ponytailFallback(level), `fallback ${level} must use ponytail's own rule`).toContain(row);
  }
});

test('each level injects its own header', async () => {
  for (const level of ['lite', 'full', 'ultra'] as const) {
    const text = await injectMarked(level);
    expect(text, `level ${level}`).toMatch(new RegExp(`PONYTAIL MODE ACTIVE — level: ${level}`));
  }
});

test('ponytail reaches a subagent that the marker does not recognise', async () => {
  // Ponytail reads shared state with no marker check, so it survives drift.
  resetSharedComboState();
  setSharedComboMode('ponytail', 'ultra');
  const drifted = 'Some entirely different subagent wording after a host update.';
  expect(await inject(drifted)).toMatch(/PONYTAIL MODE ACTIVE/);
});

// The block a previous level added is ours, so a switch replaces it, never stacks.
function promptOf(result: unknown): string[] {
  if (result && typeof result === 'object' && 'systemPrompt' in result) {
    const value = result.systemPrompt;
    return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
  }
  return [];
}

test("a level switch replaces the previous level's block", async () => {
  resetSharedComboState();
  const handler = injectHandler();
  setSharedComboMode('ponytail', 'ultra');
  const first = promptOf(await handler({ systemPrompt: 'Base.' }, undefined));

  setSharedComboMode('ponytail', 'lite');
  const joined = promptOf(await handler({ systemPrompt: first }, undefined)).join('\n');

  expect(joined).toMatch(/level: lite/);
  expect(joined).not.toMatch(/level: ultra/);
});

// pi defers to upstream only when installed; with no ponytail package in its settings it injected nothing.
test('pi without an upstream ponytail gets the built-in fallback', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-pi-nopony-'));
  const prevPi = process.env.PI_CODING_AGENT;
  const prevHome = process.env.HOME;
  try {
    // A HOME with no pi agent dir at all: nothing is declared and nothing is on disk.
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PI_CODING_AGENT = 'true';
    resetSharedComboState();
    setSharedComboMode('ponytail', 'full');
    const result = await injectHandler()({ systemPrompt: 'Base.' }, undefined);
    const prompt = (result as { systemPrompt?: string[] } | undefined)?.systemPrompt;
    expect(prompt?.at(-1)).toMatch(/PONYTAIL MODE ACTIVE/);
  } finally {
    if (prevPi === undefined) delete process.env.PI_CODING_AGENT;
    else process.env.PI_CODING_AGENT = prevPi;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// With upstream installed, pi still defers: Tersio must not double-inject.
test('pi with an upstream ponytail defers to it', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-pi-pony-'));
  const prevPi = process.env.PI_CODING_AGENT;
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const agent = path.join(home, '.pi', 'agent');
    mkdirSync(agent, { recursive: true });
    writeFileSync(
      path.join(agent, 'settings.json'),
      JSON.stringify({ packages: [path.join(home, '.pi', 'agent', 'ponytail')] }),
      'utf8',
    );
    process.env.PI_CODING_AGENT = 'true';
    resetSharedComboState();
    setSharedComboMode('ponytail', 'full');
    const result = await injectHandler()({ systemPrompt: 'Base.' }, undefined);
    expect((result as { systemPrompt?: string[] } | undefined)?.systemPrompt).toBeUndefined();
  } finally {
    if (prevPi === undefined) delete process.env.PI_CODING_AGENT;
    else process.env.PI_CODING_AGENT = prevPi;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// The pstack rigor mode. Opt-in: no combo preset turns it on, and /pstack controls it on its own.
const BODY = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'pstack', 'rule.md'),
  'utf8',
);

type pstackCommandHandler = (args: string, ctx: ExtensionCtx) => Promise<void>;
type pstackEventHandler = (event: never, ctx?: ExtensionCtx) => Promise<unknown>;

interface pstackTestPi {
  commands: Map<string, pstackCommandHandler>;
  handlers: Map<string, pstackEventHandler>;
  zod: unknown;
  setLabel(): void;
  registerCommand(name: string, config: { handler: pstackCommandHandler }): void;
  on(event: string, handler: pstackEventHandler): void;
  appendEntry(customType: string, data: Record<string, unknown>): void;
}

function instantiate(factory: (pi: ExtensionApi) => void, entries: SessionEntry[] = []): pstackTestPi {
  const commands = new Map<string, pstackCommandHandler>();
  const handlers = new Map<string, pstackEventHandler>();
  const pi: pstackTestPi = {
    commands,
    handlers,
    // Present `zod` marks this as the OMP host, so the adapter treats `systemPrompt` as an array.
    zod: { z: { object: (shape: unknown) => shape } },
    setLabel() {},
    registerCommand(name, config) {
      commands.set(name, config.handler);
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    appendEntry(customType, data) {
      entries.push({ type: 'custom', customType, data });
    },
  };
  factory(pi as unknown as ExtensionApi);
  return pi;
}

interface Harness {
  statuses: string[];
  notices: string[];
  ctx: ExtensionCtx;
}

function context(entries: SessionEntry[] = []): Harness {
  const statuses: string[] = [];
  const notices: string[] = [];
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify: (message: string) => {
        notices.push(message);
      },
      setStatus: (_name: string, value?: string) => {
        if (value !== undefined) statuses.push(value);
      },
    },
  } as unknown as ExtensionCtx;
  return { statuses, notices, ctx };
}

async function pstackInject(pi: pstackTestPi, ctx: ExtensionCtx): Promise<string> {
  const event = { systemPrompt: ['BASE'] };
  const result = (await pi.handlers.get('before_agent_start')!(event as never, ctx)) as
    | { systemPrompt?: string[] }
    | undefined;
  return (result?.systemPrompt ?? event.systemPrompt).join('\n');
}

test('/pstack on reaches the prompt body and the footer names the mode', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = instantiate(pstackSessionExtension, entries);
  const { statuses, ctx } = context(entries);

  await pi.commands.get('pstack')!('on', ctx);

  expect(statuses.at(-1)).toBe(
    '🧩 CUSTOM | 🪨 caveman:OFF | 🗜️ rtk:OFF | 🍃 headroom:OFF | 🧠 ponytail:OFF | 🥔 pstack:ON',
  );
  expect(await pstackInject(pi, ctx)).toContain(BODY);
});

test('/pstack off clears the footer and stops injecting', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = instantiate(pstackSessionExtension, entries);
  const { statuses, ctx } = context(entries);

  await pi.commands.get('pstack')!('on', ctx);
  await pi.commands.get('pstack')!('off', ctx);

  expect(statuses.at(-1)).toBe('🧩 OFF');
  expect(await pstackInject(pi, ctx)).not.toContain(BODY);
});

test('an unknown pstack level warns and leaves the mode alone', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = instantiate(pstackSessionExtension, entries);
  const { notices, ctx } = context(entries);

  await pi.commands.get('pstack')!('loud', ctx);

  expect(notices.at(-1)).toBe('Usage: /pstack [on|off|status]');
  expect(getSharedComboState().pstack).toBe('off');
});

test('a stored pstack entry restores the mode on a new session', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [{ type: 'custom', customType: 'pstack-mode', data: { mode: 'on' } }];
  const pi = instantiate(pstackSessionExtension, entries);

  await pi.handlers.get('session_start')!({} as never, context(entries).ctx);

  expect(getSharedComboState().pstack).toBe('on');
});

// The preset contract: a combo preset owns caveman, RTK and Ponytail, and leaves pstack opt-in.
test('a combo preset leaves pstack where it was, so the level still matches its modes', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const { statuses, ctx } = context(entries);

  expect(getSharedComboState().pstack).toBe('off');
  await combo.commands.get('combo')!('balanced', ctx);

  expect(getSharedComboState().pstack).toBe('off');
  expect(statuses.at(-1)).toBe(
    '🧩 BALANCED | 🪨 caveman:FULL | 🗜️ rtk:ON | 🍃 headroom:OFF | 🧠 ponytail:FULL | 🥔 pstack:OFF',
  );
});

test('a combo preset keeps a pstack the session already had', async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const pstack = instantiate(pstackSessionExtension, entries);
  const { statuses, ctx } = context(entries);

  await pstack.commands.get('pstack')!('on', ctx);
  await combo.commands.get('combo')!('lite', ctx);

  expect(getSharedComboState().pstack).toBe('on');
  expect(getSharedComboState().level).toBe('lite');
  expect(statuses.at(-1)).toBe(
    '🧩 LITE | 🪨 caveman:LITE | 🗜️ rtk:ON | 🍃 headroom:OFF | 🧠 ponytail:LITE | 🥔 pstack:ON',
  );
});

test('a host section feeds the combo defaults this host starts from', async () => {
  await withHome(async (home) => {
    mkdirSync(path.join(home, '.tersio'), { recursive: true });
    writeFileSync(
      path.join(home, '.tersio', 'settings.json'),
      JSON.stringify({
        comboDefault: 'lite',
        cavemanDefault: 'lite',
        rtkDefault: true,
        ponytailDefault: 'lite',
        hosts: { omp: { comboDefault: 'max' } },
      }),
      'utf8',
    );
    resetSharedComboState();
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const notifications: string[] = [];
    const statuses = new Map<string, string>();
    comboToggleExtension({
      zod: { z: {} },
      setLabel() {},
      registerCommand() {},
      registerTool() {},
      appendEntry() {},
      on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) {
        handlers.set(event, handler);
      },
    } as unknown as ExtensionApi);
    const ctx = {
      hasUI: true,
      notifications,
      statuses,
      sessionManager: { getBranch: () => [] },
      ui: {
        setStatus(name: string, v: string | undefined) {
          if (v !== undefined) {
            statuses.set(name, v);
            if (name === 'tersio') notifications.push(v);
          }
        },
        notify() {},
      },
    };
    await handlers.get('session_start')!({}, ctx);
    // omp reads its own section: max, not the shared lite.
    expect(statuses.get('tersio')).toBe(
      '🧩 MAX | 🪨 caveman:ULTRA | 🗜️ rtk:ON | 🍃 headroom:OFF | 🧠 ponytail:ULTRA | 🥔 pstack:OFF',
    );
  });
});

test('deriveLevel maps every preset back to its level, including balanced', () => {
  expect(deriveLevel({ caveman: 'off', rtk: 'off', ponytail: 'off', pstack: 'off', headroom: 'off' })).toBe('off');
  expect(deriveLevel({ caveman: 'lite', rtk: 'on', ponytail: 'lite', pstack: 'on', headroom: 'off' })).toBe('lite');
  expect(deriveLevel({ caveman: 'full', rtk: 'on', ponytail: 'full', pstack: 'on', headroom: 'off' })).toBe('balanced');
  expect(deriveLevel({ caveman: 'ultra', rtk: 'on', ponytail: 'ultra', pstack: 'on', headroom: 'off' })).toBe('max');
});

// pstack is opt-in, so it neither makes nor breaks a preset.
test('deriveLevel ignores pstack in both directions', () => {
  expect(deriveLevel({ caveman: 'ultra', rtk: 'on', ponytail: 'ultra', pstack: 'off', headroom: 'off' })).toBe('max');
  expect(deriveLevel({ caveman: 'off', rtk: 'off', ponytail: 'off', pstack: 'on', headroom: 'off' })).toBe('off');
});

test('the retired `medium` name still resolves to lite', () => {
  // A settings file or command written before the rename must keep working.
  expect(normalizeComboLevel('medium')).toBe('lite');
  expect(normalizeComboLevel('lite')).toBe('lite');
  expect(normalizeComboLevel('ultra')).toBe('max');
});

test('deriveLevel returns custom for mixed modes', () => {
  expect(deriveLevel({ caveman: 'full', rtk: 'off', ponytail: 'full', pstack: 'off', headroom: 'off' })).toBe('custom');
});

// A hand-changed mode still leaves every preset behind. pstack is not a preset mode, so it never does.
test('deriveLevel returns custom when a preset mode is changed by hand', () => {
  expect(deriveLevel({ caveman: 'full', rtk: 'on', ponytail: 'lite', pstack: 'off', headroom: 'off' })).toBe('custom');
  expect(deriveLevel({ caveman: 'lite', rtk: 'off', ponytail: 'lite', pstack: 'on', headroom: 'off' })).toBe('custom');
});

test('isComboPresetActive is true for presets, false for off', () => {
  try {
    for (const level of ['lite', 'balanced', 'max']) {
      setSharedComboLevel(level);
      expect(isComboPresetActive()).toBe(true);
    }
    setSharedComboLevel('off');
    expect(isComboPresetActive()).toBe(false);
  } finally {
    resetSharedComboState();
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer = path.join(root, 'dist', 'tersio.js');

function run(...args: string[]) {
  const missingHome = path.join(root, 'test', 'definitely-missing-home', 'modes');
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    env: cliEnv(missingHome),
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('combo preset implies caveman, rtk, and ponytail defaults, and leaves pstack off', () => {
  const result = run('install', '--dry-run', '--yes', '--combo-default', 'balanced');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(
    /Defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full · pstack=off · headroom=off\)/,
  );
});

test('caveman and rtk flags override the combo preset', () => {
  const result = run(
    'install',
    '--dry-run',
    '--yes',
    '--combo-default',
    'max',
    '--caveman-default',
    'lite',
    '--rtk-default',
    'off',
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(
    /Defaults: combo=max \(caveman=lite · rtk=off · ponytail=ultra · pstack=off · headroom=off\)/,
  );
});

test("ruleDir keeps a self-contained tree and falls back to the package's own extension dir", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = path.join(repoRoot, 'extensions', 'pstack');
  expect(ruleDir('pstack', source)).toBe(source);
  // An empty dir stands in for dist, whose tree holds compiled JS only.
  const bare = mkdtempSync(path.join(repoRoot, 'test', 'rule-dir-'));
  try {
    const resolved = ruleDir('pstack', bare);
    expect(resolved).toBe(source);
    expect(existsSync(path.join(resolved, 'rule.md'))).toBe(true);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

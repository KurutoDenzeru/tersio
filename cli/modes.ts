// `/prompts:*` and the shell fallback read and write the same session defaults as the MCP tool.
import { COMBO_DEFAULTS, CAVEMAN_DEFAULTS, HEADROOM_DEFAULTS, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS, RTK_DEFAULTS } from './common.ts';
import { parseHostArg } from './hosts.ts';
import { applyComboPreset, formatProfile, saveHostDefaults, storedProfile, writePluginSettings } from './profile.ts';
import type { HostDefaultField, Profile } from './profile.ts';
import { normalizeMode } from '../extensions/shared/session-state.ts';
import type { HostId } from '../extensions/shared/host-caps.ts';

type ModeName = 'combo' | 'caveman' | 'rtk' | 'ponytail' | 'pstack' | 'headroom';
const MODES = new Set<ModeName>(['combo', 'caveman', 'rtk', 'ponytail', 'pstack', 'headroom']);

function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--host') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) out.push(arg);
  }
  return out;
}

function booleanMode(value: string): 'on' | 'off' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === 'enable' || normalized === 'enabled') return 'on';
  if (normalized === 'off' || normalized === 'false' || normalized === 'disable' || normalized === 'disabled') return 'off';
  return null;
}

export async function runModes(argv: string[]): Promise<void> {
  let host: HostId | undefined;
  try {
    host = parseHostArg(argv);
  } catch (error) {
    console.error(`[fail] ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const words = positional(argv);
  const current = await storedProfile(host ?? null);
  const mode = words[0]?.toLowerCase() as ModeName | undefined;
  const value = words[1]?.toLowerCase();
  if (!mode || !MODES.has(mode)) {
    if (mode) {
      console.error(`[fail] unknown mode: ${mode}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Current session defaults${host ? ` for ${host}` : ''}: ${formatProfile(current)}`);
    return;
  }
  if (!value || value === 'status') {
    console.log(`Current session defaults${host ? ` for ${host}` : ''}: ${formatProfile(current)}`);
    return;
  }
  if (mode === 'combo' && (value === 'help' || value === '?')) {
    console.log('Combo presets: off, lite, balanced, max. lite/balanced/max set caveman, RTK, and Ponytail together.');
    return;
  }

  let next: Profile = current;
  const fields: HostDefaultField[] = [];
  if (mode === 'combo') {
    const level = value === 'ultra' ? 'max' : value === 'full' ? 'balanced' : value === 'medium' ? 'lite' : value;
    if (!COMBO_DEFAULTS.has(level)) {
      console.error(`[fail] invalid combo level: ${value}`);
      process.exitCode = 1;
      return;
    }
    next = applyComboPreset(current, level);
    fields.push('comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault');
  } else if (mode === 'caveman') {
    const normalized = normalizeMode('caveman', value);
    if (!normalized || !CAVEMAN_DEFAULTS.has(normalized)) {
      console.error(`[fail] invalid caveman level: ${value}`);
      process.exitCode = 1;
      return;
    }
    next = { ...current, cavemanDefault: normalized };
    fields.push('cavemanDefault');
  } else if (mode === 'ponytail') {
    const normalized = normalizeMode('ponytail', value);
    if (!normalized || !PONYTAIL_DEFAULTS.has(normalized)) {
      console.error(`[fail] invalid ponytail level: ${value}`);
      process.exitCode = 1;
      return;
    }
    next = { ...current, ponytailDefault: normalized };
    fields.push('ponytailDefault');
  } else if (mode === 'rtk' || mode === 'pstack' || mode === 'headroom') {
    const toggled = booleanMode(value);
    const valid = mode === 'rtk' ? RTK_DEFAULTS : mode === 'pstack' ? PSTACK_DEFAULTS : HEADROOM_DEFAULTS;
    if (!toggled || !valid.has(toggled)) {
      console.error(`[fail] invalid ${mode} value: ${value}`);
      process.exitCode = 1;
      return;
    }
    if (mode === 'rtk') next = { ...current, rtkDefault: toggled === 'on' };
    else if (mode === 'pstack') next = { ...current, pstackDefault: toggled };
    else next = { ...current, headroomDefault: toggled };
    fields.push(mode === 'rtk' ? 'rtkDefault' : mode === 'pstack' ? 'pstackDefault' : 'headroomDefault');
  }

  if (host) await saveHostDefaults(host, fields, next, { quiet: true });
  else await writePluginSettings(next, { quiet: true });
  console.log(`Session defaults${host ? ` for ${host}` : ''} saved: ${formatProfile(next)}`);
}

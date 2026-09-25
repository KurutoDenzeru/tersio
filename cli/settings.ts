// cli/settings.ts — view/edit session-start defaults (combo/caveman/rtk/ponytail)
// plus the display-currency default for usage/dashboard reports.
// Non-interactive: `tersio settings --combo-default balanced` (plus per-mode
// override flags and --currency). Interactive: clack selects seeded from the
// stored profile.
import path from 'node:path';
import {
  CAVEMAN_DEFAULTS, COMBO_DEFAULTS, COMBO_PRESET_MODES, OMP_PLUGINS_DIR, PACKAGE_NAME,
  PONYTAIL_DEFAULTS, cavemanDefaultFlag, comboDefaultFlag, currency, currencyGiven, diagScheduleFlag, dryRun,
  ponytailDefaultFlag, profileFlagsGiven, rtkDefaultFlag, settingArg,
} from './common.ts';
import { CURRENCY_CODES } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { textTable } from './usage.ts';
import { askInteractiveChoice, closeRL, tty } from './interactive.ts';
import { formatProfile, storedProfile, writePluginSettings } from './profile.ts';
import type { Profile } from './profile.ts';
import { readDiagSchedule, setDiagSchedule } from './dashboard.ts';
import type { DiagSchedule } from './dashboard.ts';

function applyFlags(base: Profile): Profile {
  const next: Profile = { ...base };
  if (comboDefaultFlag !== undefined) next.comboDefault = comboDefaultFlag;
  const preset = COMBO_PRESET_MODES[next.comboDefault] ?? COMBO_PRESET_MODES.off;
  next.cavemanDefault = preset.caveman;
  next.rtkDefault = preset.rtk;
  next.ponytailDefault = preset.ponytail;
  if (cavemanDefaultFlag !== undefined) next.cavemanDefault = cavemanDefaultFlag;
  if (rtkDefaultFlag !== undefined) next.rtkDefault = rtkDefaultFlag === 'on';
  if (ponytailDefaultFlag !== undefined) next.ponytailDefault = ponytailDefaultFlag;
  if (currencyGiven) next.currency = currency;
  return next;
}

async function askProfile(current: Profile): Promise<Profile | null> {
  const combo = await askInteractiveChoice('Session-start defaults — Combo preset', [
    { value: 'off', label: 'off' },
    { value: 'medium', label: 'medium', hint: 'caveman=lite, rtk=on, ponytail=lite' },
    { value: 'balanced', label: 'balanced', hint: 'caveman=full, rtk=on, ponytail=full' },
    { value: 'max', label: 'max', hint: 'caveman=ultra, rtk=on, ponytail=ultra' },
  ], current.comboDefault);
  if (combo.status !== 'selected') return null;
  const preset = COMBO_PRESET_MODES[combo.value] ?? COMBO_PRESET_MODES.off;
  const next: Profile = {
    comboDefault: combo.value,
    cavemanDefault: preset.caveman,
    rtkDefault: preset.rtk,
    ponytailDefault: preset.ponytail,
    currency: current.currency,
  };

  const caveman = await askInteractiveChoice('Caveman default', [...CAVEMAN_DEFAULTS].map((v) => ({
    value: v, label: v,
  })), next.cavemanDefault);
  if (caveman.status !== 'selected') return null;
  next.cavemanDefault = caveman.value;

  const rtk = await askInteractiveChoice('RTK default', [
    { value: 'on', label: 'on' },
    { value: 'off', label: 'off' },
  ], next.rtkDefault ? 'on' : 'off');
  if (rtk.status !== 'selected') return null;
  next.rtkDefault = rtk.value === 'on';

  const ponytail = await askInteractiveChoice('Ponytail default', [...PONYTAIL_DEFAULTS].map((v) => ({
    value: v, label: v,
  })), next.ponytailDefault);
  if (ponytail.status !== 'selected') return null;
  next.ponytailDefault = ponytail.value;

  const cur = await askInteractiveChoice('Display currency (usage/dashboard reports)', CURRENCY_CODES.map((v) => ({
    value: v, label: v,
  })), next.currency);
  if (cur.status !== 'selected') return null;
  next.currency = cur.value as CurrencyCode;

  return next;
}

async function askDiagSchedule(current: DiagSchedule): Promise<DiagSchedule | null> {
  const picked = await askInteractiveChoice('Diagnosis auto-check', [
    { value: 'manual', label: 'manual', hint: 'check on open' },
    { value: 'daily', label: 'daily' },
    { value: 'weekly', label: 'weekly' },
    { value: 'monthly', label: 'monthly' },
  ], current);
  if (picked.status !== 'selected') return null;
  return picked.value as DiagSchedule;
}

const SETTING_NAMES = ['combo', 'caveman', 'rtk', 'ponytail', 'currency', 'diagnosis'] as const;

function settingsUsage(): void {
  console.log('  Usage: tersio settings [combo|caveman|rtk|ponytail|currency|diagnosis] [--combo-default off|medium|balanced|max] [--caveman-default off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra] [--rtk-default on|off] [--ponytail-default off|lite|full|ultra] [--currency USD|PHP|EUR|GBP|JPY|KRW|SGD|AUD|CAD|INR] [--diag-schedule manual|daily|weekly|monthly] [--dry-run]');
}

// Single-setting jump: `tersio settings diagnosis` prompts only that value
// instead of walking the whole chain. Returns false when aborted.
async function runSingleSetting(name: string, current: Profile, nextDiag: DiagSchedule): Promise<{ profile: Profile; diag: DiagSchedule } | null> {
  const next: Profile = { ...current };
  let diag = nextDiag;
  switch (name) {
    case 'combo': {
      const combo = await askInteractiveChoice('Session-start defaults — Combo preset', [
        { value: 'off', label: 'off' },
        { value: 'medium', label: 'medium', hint: 'caveman=lite, rtk=on, ponytail=lite' },
        { value: 'balanced', label: 'balanced', hint: 'caveman=full, rtk=on, ponytail=full' },
        { value: 'max', label: 'max', hint: 'caveman=ultra, rtk=on, ponytail=ultra' },
      ], current.comboDefault);
      if (combo.status !== 'selected') return null;
      const preset = COMBO_PRESET_MODES[combo.value] ?? COMBO_PRESET_MODES.off;
      next.comboDefault = combo.value;
      next.cavemanDefault = preset.caveman;
      next.rtkDefault = preset.rtk;
      next.ponytailDefault = preset.ponytail;
      break;
    }
    case 'caveman': {
      const picked = await askInteractiveChoice('Caveman default', [...CAVEMAN_DEFAULTS].map((v) => ({
        value: v, label: v,
      })), next.cavemanDefault);
      if (picked.status !== 'selected') return null;
      next.cavemanDefault = picked.value;
      break;
    }
    case 'rtk': {
      const picked = await askInteractiveChoice('RTK default', [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ], next.rtkDefault ? 'on' : 'off');
      if (picked.status !== 'selected') return null;
      next.rtkDefault = picked.value === 'on';
      break;
    }
    case 'ponytail': {
      const picked = await askInteractiveChoice('Ponytail default', [...PONYTAIL_DEFAULTS].map((v) => ({
        value: v, label: v,
      })), next.ponytailDefault);
      if (picked.status !== 'selected') return null;
      next.ponytailDefault = picked.value;
      break;
    }
    case 'currency': {
      const picked = await askInteractiveChoice('Display currency (usage/dashboard reports)', CURRENCY_CODES.map((v) => ({
        value: v, label: v,
      })), next.currency);
      if (picked.status !== 'selected') return null;
      next.currency = picked.value as CurrencyCode;
      break;
    }
    case 'diagnosis': {
      const picked = await askDiagSchedule(diag);
      if (picked === null) return null;
      diag = picked;
      break;
    }
    default: {
      console.error(`[fail] Invalid setting: ${name}. Valid: ${SETTING_NAMES.join(', ')}`);
      process.exit(1);
    }
  }
  return { profile: next, diag };
}

function printSettingsTable(current: Profile): void {
  console.log('\n=== Tersio Settings ===');
  // Currency lives here no longer: the dashboard owns displaying and
  // persisting it (its picker POSTs to /currency); settings can still set
  // the stored default via --currency or the prompt below.
  const rows = [
    ['combo', current.comboDefault, [...COMBO_DEFAULTS].join(' | ')],
    ['caveman', current.cavemanDefault, [...CAVEMAN_DEFAULTS].join(' | ')],
    ['rtk', current.rtkDefault ? 'on' : 'off', 'on | off'],
    ['ponytail', current.ponytailDefault, [...PONYTAIL_DEFAULTS].join(' | ')],
    ['diagnosis', readDiagSchedule(), 'manual | daily | weekly | monthly'],
  ];
  for (const l of textTable(['Setting', 'Current', 'Valid values'], rows, [false, false, false], 64)) {
    console.log(l);
  }
  console.log(`  Stored: ${PACKAGE_NAME} in ${path.join(OMP_PLUGINS_DIR, 'omp-plugins.lock.json')}`);
}

async function runSettings(): Promise<void> {
  const current = await storedProfile();
  printSettingsTable(current);

  let next: Profile | null;
  let nextDiag: DiagSchedule = readDiagSchedule();
  if (diagScheduleFlag !== undefined) nextDiag = diagScheduleFlag as DiagSchedule;
  if (settingArg !== null) {
    if (!(SETTING_NAMES as readonly string[]).includes(settingArg)) {
      console.error(`[fail] Invalid setting: ${settingArg}. Valid: ${SETTING_NAMES.join(', ')}`);
      closeRL();
      process.exit(1);
      return;
    }
    if (!tty()) {
      console.log('\n  Single-setting jump needs a terminal.');
      settingsUsage();
      closeRL();
      return;
    }
    const single = await runSingleSetting(settingArg, current, nextDiag);
    if (single === null) {
      closeRL();
      process.exit(130);
      return;
    }
    next = single.profile;
    nextDiag = single.diag;
  } else if (profileFlagsGiven || currencyGiven || diagScheduleFlag !== undefined) {
    next = applyFlags(current);
  } else if (tty()) {
    next = await askProfile(current);
    if (next === null) {
      closeRL();
      process.exit(130);
      return;
    }
    const picked = await askDiagSchedule(nextDiag);
    if (picked === null) {
      closeRL();
      process.exit(130);
      return;
    }
    nextDiag = picked;
  } else {
    console.log('\n  No flags given and no TTY — nothing to change.');
    settingsUsage();
    closeRL();
    return;
  }

  if (dryRun) {
    console.log(`\n  [dry-run] would set defaults: ${formatProfile(next)} · diagnosis=${nextDiag}`);
    closeRL();
    return;
  }
  await writePluginSettings(next, {});
  setDiagSchedule(nextDiag);
  console.log(`  Defaults: ${formatProfile(next)} · diagnosis=${nextDiag}`);
  console.log('  Applies to fresh sessions only — anything persisted with /combo, /caveman, or /rtk wins.');
  console.log('  Currency applies to usage/dashboard reports; --currency overrides it per run.');
  closeRL();
}

export { runSettings };

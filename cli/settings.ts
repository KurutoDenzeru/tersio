// cli/settings.ts — view/edit session-start defaults (combo/caveman/rtk/ponytail)
// plus the display-currency default for usage/gain reports.
// Non-interactive: `tersio settings --combo-default balanced` (plus per-mode
// override flags and --currency). Interactive: clack selects seeded from the
// stored profile.
import path from 'node:path';
import {
  CAVEMAN_DEFAULTS, COMBO_DEFAULTS, COMBO_PRESET_MODES, OMP_PLUGINS_DIR, PACKAGE_NAME,
  PONYTAIL_DEFAULTS, cavemanDefaultFlag, comboDefaultFlag, currency, currencyGiven, dryRun,
  ponytailDefaultFlag, profileFlagsGiven, rtkDefaultFlag,
} from './common.ts';
import { CURRENCY_CODES } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { textTable } from './usage.ts';
import { askInteractiveChoice, closeRL, tty } from './interactive.ts';
import { formatProfile, storedProfile, writePluginSettings } from './profile.ts';
import type { Profile } from './profile.ts';

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

  const cur = await askInteractiveChoice('Display currency (usage/gain reports)', CURRENCY_CODES.map((v) => ({
    value: v, label: v,
  })), next.currency);
  if (cur.status !== 'selected') return null;
  next.currency = cur.value as CurrencyCode;

  return next;
}

function printSettingsTable(current: Profile): void {
  console.log('\n=== Tersio Settings ===');
  // Currency lives here no longer: the gain dashboard owns displaying and
  // persisting it (its picker POSTs to /currency); settings can still set
  // the stored default via --currency or the prompt below.
  const rows = [
    ['combo', current.comboDefault, [...COMBO_DEFAULTS].join(' | ')],
    ['caveman', current.cavemanDefault, [...CAVEMAN_DEFAULTS].join(' | ')],
    ['rtk', current.rtkDefault ? 'on' : 'off', 'on | off'],
    ['ponytail', current.ponytailDefault, [...PONYTAIL_DEFAULTS].join(' | ')],
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
  if (profileFlagsGiven || currencyGiven) {
    next = applyFlags(current);
  } else if (tty()) {
    next = await askProfile(current);
    if (next === null) {
      closeRL();
      process.exit(130);
      return;
    }
  } else {
    console.log('\n  No flags given and no TTY — nothing to change.');
    console.log('  Usage: tersio settings [--combo-default off|medium|balanced|max] [--caveman-default off|lite|full|ultra|wenyan] [--rtk-default on|off] [--ponytail-default off|lite|full|ultra|review] [--currency USD|PHP|EUR|GBP|JPY|KRW|SGD|AUD|CAD|INR] [--dry-run]');
    closeRL();
    return;
  }

  if (dryRun) {
    console.log(`\n  [dry-run] would set defaults: ${formatProfile(next)}`);
    closeRL();
    return;
  }
  await writePluginSettings(next, {});
  console.log(`  Defaults: ${formatProfile(next)}`);
  console.log('  Applies to fresh sessions only — anything persisted with /combo, /caveman, or /rtk wins.');
  console.log('  Currency applies to usage/gain reports; --currency overrides it per run.');
  closeRL();
}

export { runSettings };

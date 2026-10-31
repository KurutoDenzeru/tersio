// Shared Ponytail instruction builder for the pi extension and the omp combo hook.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODE, normalizeMode, normalizePersistedMode } from './ponytail-config.ts';

// The one mode whose instructions live in a skill of its own instead of the shared SKILL.md table.
const SKILL_ONLY_MODE = 'review';
const SKILL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ponytail', 'SKILL.md');

export function filterSkillBodyForMode(body: unknown, mode: unknown): string {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  const withoutFrontmatter = String(body || '').replace(/^---[\s\S]*?---\s*/, '');

  // Only the intensity table rows and worked examples are mode-specific, and both are keyed by a mode name (lite/full/ultra). A bullet whose label is not a mode — e.g. "No unrequested abstractions: ...
  return withoutFrontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      // Require a quoted value: every worked example is `- lite: "..."`. Without this, an ordinary rule bullet that happens to start with a mode word (e.g. "- Full: ...
      const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      return true;
    })
    .join('\n');
}

// One ruleset, one source: SKILL.md. This stub exists only for a broken install, so it names the repair instead of carrying a second copy of the rules that would drift.
function getFallbackInstructions(mode: string): string {
  return 'PONYTAIL MODE ACTIVE — level: ' + mode + '\n\n' +
    'The Ponytail ruleset file is missing from this install, so the full rules could not load. Run `tersio doctor --fix` to restore `skills/ponytail/SKILL.md`.\n';
}

export function getPonytailInstructions(mode: unknown): string {
  const configuredMode = normalizePersistedMode(mode) || DEFAULT_MODE;

  if (configuredMode === SKILL_ONLY_MODE) {
    return 'PONYTAIL MODE ACTIVE — level: ' + configuredMode + '. Behavior defined by /ponytail-' + configuredMode + ' skill.';
  }

  const effectiveMode = normalizeMode(configuredMode) || DEFAULT_MODE;

  try {
    return 'PONYTAIL MODE ACTIVE — level: ' + effectiveMode + '\n\n' +
      filterSkillBodyForMode(fs.readFileSync(SKILL_PATH, 'utf8'), effectiveMode);
  } catch {
    return getFallbackInstructions(effectiveMode);
  }
}
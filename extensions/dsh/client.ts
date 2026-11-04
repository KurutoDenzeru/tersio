// Tersio's Web status bar: a pill under the composer that reads the combo and opens a mode switcher.
// Authored in TypeScript; tsc emits the browser bundle to dist/, so no .js is checked in.
type Modes = { caveman: string; rtk: boolean; ponytail: string; pstack: string | boolean; headroom: string };
type StatusPayload = { text: string; level: string; modes: Modes };
type Change = { combo?: string; mode?: string; value?: string };

type Loader = { load(spec: { id: string; factory(require: (name: string) => unknown): unknown }): void };

// The shell injects this facade before any bundle loads; the bar only registers through it.
// Read by string key: the identifier would dangle under the project's lint rules, and the file must stay a plain script.
const loader = (globalThis as unknown as Record<string, Loader | undefined>)['__ModuleLoader__'];
if (!loader) throw new Error('tersio: the client module loader is missing');

const ENDPOINT = '/tersio/modes';
const POLL_MS = 2000;
const HINT = 'Tersio modes. Click to see every mode and switch them.';
// Commands whose effect is the bar itself; their chat row is redundant.
const QUIET_COMMANDS = ['combo', 'caveman', 'rtk', 'ponytail', 'pstack'];

// Lucide "puzzle" path, inline because lucide-react is not in the Client module table.
const PUZZLE = 'M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z';

const PRESETS = [
  { key: 'off', label: 'Off' },
  { key: 'lite', label: 'Lite' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'max', label: 'Max' },
] as const;

function current(modes: Modes, key: string): string {
  if (key === 'rtk') return modes.rtk ? 'on' : 'off';
  if (key === 'pstack') return modes.pstack === true || modes.pstack === 'on' ? 'on' : 'off';
  return String((modes as unknown as Record<string, unknown>)[key] ?? 'off');
}

const LEVEL_WORDS: Record<string, string> = { off: 'Off', lite: 'Lite', balanced: 'Balanced', max: 'Max', custom: 'Custom' };

const MODES = [
  { key: 'caveman', glyph: '🪨', name: 'Caveman', values: ['off', 'lite', 'full', 'ultra'] },
  { key: 'rtk', glyph: '🗜️', name: 'RTK', values: ['off', 'on'] },
  { key: 'headroom', glyph: '🍃', name: 'Headroom', values: ['off', 'on'] },
  { key: 'ponytail', glyph: '🧠', name: 'Ponytail', values: ['off', 'lite', 'full', 'ultra'] },
  { key: 'pstack', glyph: '🥔', name: 'pstack', values: ['off', 'on'] },
] as const;

/** `lite` -> `Lite`, `megacave-lite` -> `Megacave lite`: full words, never an invented abbreviation. */
function labelOf(value: string): string {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

// Kept in the bundle so unmounting the module removes the styles with it.
const STYLES = `
.tersio-wrap { position: relative; display: inline-flex; justify-content: center; }
.tersio-bar {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 10px 2px 8px; border: 0; border-radius: 999px; corner-shape: round;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; white-space: nowrap;
}
.tersio-bar:hover, .tersio-bar[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary);
}
.tersio-bar__icon { flex: none; opacity: .9; }
.tersio-pop {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 6px); z-index: 40;
  width: max-content; max-width: min(340px, calc(100vw - 24px)); padding: 10px 12px;
  border: 0; border-radius: var(--dsw-radius-lg);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; text-align: left; white-space: normal;
}
.tersio-pop__row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 2px 0; }
.tersio-pop__name { flex: none; width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
/* One track per row: a segmented control reads tighter than six separate buttons. */
.tersio-pop__options {
  display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
}
.tersio-pill {
  padding: 2px 9px; border: 0; border-radius: 999px; background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 15px; cursor: pointer; white-space: nowrap;
}
.tersio-pill:hover { color: var(--dsw-alias-label-primary); }
.tersio-pill[data-active='true'] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px rgb(0 0 0 / .18);
}
`;

loader?.load({
  id: '@krtclcdy/tersio',
  factory(require) {
    const React = require('react') as {
      createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;
      useState: <T>(value: T) => [T, (next: T) => void];
      useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => void;
      useRef: <T>(value: T) => { current: T };
    };
    const h = React.createElement;

    function TersioStatusBar(): unknown {
      const [payload, setPayload] = React.useState<StatusPayload | null>(null);
      const [open, setOpen] = React.useState(false);
      const wrap = React.useRef<HTMLElement | null>(null);

      React.useEffect(() => {
        let live = true;
        const read = () => {
          fetch(ENDPOINT, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((next: StatusPayload | null) => {
              if (live && next) setPayload(next);
            })
            .catch(() => {});
        };
        read();
        const timer = setInterval(read, POLL_MS);
        return () => {
          live = false;
          clearInterval(timer);
        };
      }, []);

      // Dismiss the popover on an outside click or Escape, like any other composer popover.
      React.useEffect(() => {
        if (!open) return;
        const onDown = (event: Event) => {
          if (!wrap.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: Event) => {
          if ((event as KeyboardEvent).key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const send = (change: Change) => {
        fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(change) })
          .then((response) => (response.ok ? response.json() : null))
          .then((next: StatusPayload | null) => {
            if (next) setPayload(next);
          })
          .catch(() => {});
      };

      if (!payload) return null;

      const pill = (label: string, active: boolean, onClick: () => void, key: string) => h('button', {
        className: 'tersio-pill', type: 'button', key,
        'data-active': active ? 'true' : 'false',
        onClick,
      }, label);

      const comboRow = h('div', { className: 'tersio-pop__row' },
        h('span', { className: 'tersio-pop__name' }, '🧩 Combo'),
        h('span', { className: 'tersio-pop__options' },
          ...PRESETS.map((preset) => pill(preset.label, payload.level === preset.key, () => send({ combo: preset.key }), preset.key))));

      const modeRows = MODES.map((mode) => h('div', { className: 'tersio-pop__row', key: mode.key },
        h('span', { className: 'tersio-pop__name' }, `${mode.glyph} ${mode.name}`),
        h('span', { className: 'tersio-pop__options' },
          ...mode.values.map((value) => pill(
            labelOf(value),
            current(payload.modes, mode.key) === value,
            () => send({ mode: mode.key, value }),
            value,
          )))));

      const icon = h('svg', {
        className: 'tersio-bar__icon', viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      }, h('path', { d: PUZZLE }));

      const popover = open
        ? h('div', { className: 'tersio-pop', role: 'dialog', 'aria-label': 'Tersio modes' }, comboRow, ...modeRows)
        : null;

      return h('div', { className: 'tersio-wrap', ref: wrap },
        h('style', null, STYLES),
        h('button', {
          className: 'tersio-bar', type: 'button', title: HINT,
          'aria-expanded': open ? 'true' : 'false', 'aria-label': payload.text,
          onClick: () => setOpen(!open),
        }, icon, h('span', null, LEVEL_WORDS[payload.level] ?? payload.level)),
        popover);
    }

    return {
      inject: ['slots'],
      apply(ctx: { slots: { inject: (name: string, callback: () => unknown) => void; register: (options: Record<string, unknown>, component: unknown) => () => void } }) {
        // Below the composer card, beside the shipped activity and usage entries.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'tersio-statusbar',
          order: 5,
        }, TersioStatusBar));

        // A mode switch already shows in the pill, so its command row renders nothing instead of echoing the change.
        for (const key of QUIET_COMMANDS) {
          ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
            name: 'conversation.chat.commandview',
            key,
          }, () => null));
        }
      },
    };
  },
});

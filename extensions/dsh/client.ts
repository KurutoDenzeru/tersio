// Tersio's Web status bar: one muted line under the composer, fed by GET /tersio/modes.
// Authored in TypeScript; tsc emits the browser bundle to dist/, so no .js is checked in.
type StatusPayload = { text: string };

type Loader = { load(spec: { id: string; factory(require: (name: string) => unknown): unknown }): void };

// The shell injects this facade before any bundle loads; the bar only registers through it.
interface Window {
  __ModuleLoader__: Loader;
}

const ENDPOINT = '/tersio/modes';
const POLL_MS = 2000;
const HINT = 'Tersio modes. Change them with /combo, /caveman, /rtk, /ponytail, or /pstack.';

// Kept in the bundle so unmounting the module removes the styles with it.
const STYLES = `
.tersio-bar {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  margin: 2px 2px 0; color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 16px;
  opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tersio-bar:hover { opacity: 1; }
`;

window.__ModuleLoader__.load({
  id: '@krtclcdy/tersio',
  factory(require) {
    const React = require('react') as {
      createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;
      useState: <T>(value: T) => [T, (next: T) => void];
      useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => void;
    };
    const h = React.createElement;

    function useStatus(): string {
      const [text, setText] = React.useState('');
      React.useEffect(() => {
        let live = true;
        const read = () => {
          fetch(ENDPOINT, { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload: StatusPayload | null) => {
              if (live && typeof payload?.text === 'string') setText(payload.text);
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
      return text;
    }

    function TersioStatusBar(): unknown {
      const text = useStatus();
      if (!text) return null;
      return h('div', { className: 'tersio-bar', role: 'status', 'aria-live': 'polite', title: HINT },
        h('style', null, STYLES),
        text);
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
      },
    };
  },
});

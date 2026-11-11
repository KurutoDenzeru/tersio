// Guards the Claude Code mod: the strip re-reads settings, and the prompt hook injects the active modes.
import { describe, expect, test } from 'vitest';
import { register } from '../../plugins/claude/hooks/register.ts';
import { claudeLocalPluginFiles } from '../../extensions/shared/claude-plugin.ts';

type Hook = (...args: unknown[]) => unknown;

interface World {
  settings: { text: string };
  claude: { text: string };
  modeContext: string;
}

function harness(world: World) {
  const handlers: Array<{ event: string; matcher: unknown; hook: Hook }> = [];
  register((event: string, matcherOrHook: unknown, maybeHook?: Hook) => {
    const hook = (maybeHook ?? matcherOrHook) as Hook;
    handlers.push({ event, matcher: maybeHook ? matcherOrHook : null, hook });
  });
  const $ = {
    env: {
      get: async (name: string) => (name === 'CLAUDE_PLUGIN_ROOT' ? '/plugin' : '/home/tester'),
    },
    fs: {
      exists: async () => true,
      read: async (file: string) => {
        if (file.includes('mode-context.json')) return world.modeContext;
        if (file.includes('.claude/settings.json')) return world.claude.text;
        return world.settings.text;
      },
    },
    ui: { resolve: () => ({ Text: ({ children }: { children: string[] }) => children[0] }) },
  };
  const hook = (event: string): Hook => {
    const found = handlers.find((entry) => entry.event === event)?.hook;
    if (!found) throw new Error(`${event} hook is missing`);
    return found;
  };
  return {
    render: (): unknown => hook('ui.render')($, {}, (value: unknown) => value),
    prompt: (e: Record<string, unknown>): unknown => hook('prompt.submit')($, e, (value: unknown) => value),
  };
}

function world(settings: Record<string, unknown>, modeContext: Record<string, unknown>, routed = false): World {
  return {
    settings: { text: JSON.stringify(settings) },
    claude: { text: JSON.stringify({ env: routed ? { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787' } : {} }) },
    modeContext: JSON.stringify(modeContext),
  };
}

describe('Claude Code mode strip', () => {
  test('a later settings write reaches the next render', async () => {
    const state = world({ hosts: { claude: { cavemanDefault: 'lite' } } }, {});
    const { render } = harness(state);
    expect(String(await render())).toContain('caveman:LITE');
    state.settings.text = JSON.stringify({
      hosts: { claude: { cavemanDefault: 'full', headroomDefault: 'on' } },
    });
    expect(String(await render())).toContain('caveman:FULL');
    expect(String(await render())).toContain('headroom:ON');
  });
});

describe('Claude Code mode prompt', () => {
  const context = {
    caveman: { lite: 'CAVEMAN LITE BODY', full: 'CAVEMAN FULL BODY' },
    ponytail: { lite: 'PONYTAIL LITE BODY' },
    pstack: 'PSTACK BODY',
    headroom: 'HEADROOM BODY',
  };

  test('the active mode bodies ride the first prompt', async () => {
    const { prompt } = harness(
      world(
        {
          hosts: {
            claude: {
              cavemanDefault: 'lite',
              ponytailDefault: 'lite',
              pstackDefault: 'on',
              headroomDefault: 'on',
            },
          },
        },
        context,
      ),
    );
    const result = (await prompt({ text: 'hello' })) as { context?: string[] };
    const text = (result.context ?? []).join('\n');
    expect(text).toContain('CAVEMAN LITE BODY');
    expect(text).toContain('PONYTAIL LITE BODY');
    expect(text).toContain('PSTACK BODY');
    // Nothing is compressed while Claude bypasses the proxy, so the recovery block would lie.
    expect(text).not.toContain('HEADROOM BODY');
  });

  test('the headroom block arrives only while routed', async () => {
    const { prompt } = harness(world({ hosts: { claude: { headroomDefault: 'on' } } }, context, true));
    const result = (await prompt({ text: 'hello' })) as { context?: string[] };
    expect((result.context ?? []).join('\n')).toContain('HEADROOM BODY');
  });
});

test('the installed plugin ships the generated mode bodies', () => {
  const files = claudeLocalPluginFiles();
  const text = files['tersio/hooks/mode-context.json'];
  expect(text).toContain('Caveman lite active');
  expect(text).toContain('pstack');
});

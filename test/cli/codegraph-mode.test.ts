import { describe, expect, test } from 'vitest';
import { codexSlashCommand, codexStatusLine } from '../../extensions/shared/codex-plugin.ts';
import { CODEGRAPH_HOSTS, codegraphReachable, readCodegraphDefault } from '../../extensions/shared/plugin-settings.ts';
import { formatModeLine } from '../../extensions/shared/mode-notice.ts';

// Both hosts read the stored default. A hardcoded 'off' hid a mode the installer had already turned on.
describe('the codegraph mode reaches every host that answers it', () => {
  test('codex reports the stored default, not a hardcoded off', () => {
    expect(readCodegraphDefault('codex')).toBe('on');
    expect(codexStatusLine()).toContain('codegraph:ON');
  });

  test('codex answers the /codegraph slash command', () => {
    const status = codexSlashCommand('/codegraph', 'test-session');
    expect(status?.message).toContain('codegraph is');
    expect(status?.patch).toEqual({});

    const on = codexSlashCommand('/codegraph on', 'test-session');
    expect(on?.patch).toEqual({ codegraphDefault: 'on' });

    const off = codexSlashCommand('/codegraph off', 'test-session');
    expect(off?.patch).toEqual({ codegraphDefault: 'off' });

    const bogus = codexSlashCommand('/codegraph bogus', 'test-session');
    expect(bogus?.patch).toEqual({});
    expect(bogus?.message).toContain('unknown value');
  });

  test('every host that answers codegraph is one the mode line can render', () => {
    const modes = {
      caveman: 'off',
      rtk: false,
      ponytail: 'off',
      pstack: 'off',
      headroom: 'off',
      codegraph: readCodegraphDefault('dsh'),
    };
    expect(formatModeLine(modes)).toContain('codegraph=on');
  });

  test('the reachable set covers the hosts the dashboard offers it to', () => {
    for (const host of CODEGRAPH_HOSTS) expect(codegraphReachable(host)).toBe(true);
    expect(codegraphReachable('codex')).toBe(true);
    expect(codegraphReachable('dsh')).toBe(true);
    expect(codegraphReachable('claude')).toBe(false);
  });
});

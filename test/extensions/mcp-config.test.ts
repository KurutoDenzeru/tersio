import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ensureTersioMcp, removeTersioMcp, spliceTopLevelKey, tersioMcpConfigured, tersioMcpFile, tersioMcpSupported } from '../../extensions/shared/mcp-config.ts';
import { withHome } from '../helpers/env.ts';

test('omp gets one Tersio MCP entry, and another server survives', () => {
  withHome((home) => {
    const file = path.join(home, '.omp', 'agent', 'mcp.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'other' } } }), 'utf8');
    expect(tersioMcpConfigured('omp')).toBe(false);
    expect(ensureTersioMcp('omp')).toBe(true);
    expect(tersioMcpConfigured('omp')).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(data.mcpServers.other).toEqual({ command: 'other' });
    expect(data.mcpServers.tersio).toEqual({ command: expect.stringMatching(/tersio(\.cmd|\.exe|\.js)?$/), args: ['mcp'], enabled: true });
    expect(tersioMcpFile('omp')).toBe(file);
    // A second install is idempotent.
    const before = readFileSync(file, 'utf8');
    expect(ensureTersioMcp('omp')).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(removeTersioMcp('omp')).toBe(true);
    expect(tersioMcpConfigured('omp')).toBe(false);
  });
});

test('pi and pig share the same mcpServers shape', () => {
  withHome((home) => {
    const saved = {
      PIG_HOME: process.env.PIG_HOME,
      PIG_CODING_AGENT_DIR: process.env.PIG_CODING_AGENT_DIR,
      PIG_USE_PI_DIRS: process.env.PIG_USE_PI_DIRS,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    process.env.PIG_HOME = path.join(home, 'pig');
    delete process.env.PIG_CODING_AGENT_DIR;
    delete process.env.PIG_USE_PI_DIRS;
    delete process.env.XDG_CONFIG_HOME;
    try {
      expect(tersioMcpSupported('pi')).toBe(true);
      expect(tersioMcpSupported('pig')).toBe(true);
      expect(ensureTersioMcp('pi')).toBe(true);
      expect(ensureTersioMcp('pig')).toBe(true);
      const pi = JSON.parse(readFileSync(tersioMcpFile('pi') as string, 'utf8')) as { mcpServers: Record<string, unknown> };
      const pig = JSON.parse(readFileSync(tersioMcpFile('pig') as string, 'utf8')) as { mcpServers: Record<string, unknown> };
      const tersioEntry = { command: expect.stringMatching(/tersio(\.cmd|\.exe|\.js)?$/), args: ['mcp'], enabled: true };
      expect(pi.mcpServers.tersio).toEqual(tersioEntry);
      expect(pig.mcpServers.tersio).toEqual(tersioEntry);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

test('the legacy Headroom entry is replaced, not left beside Tersio', () => {
  withHome((home) => {
    const file = path.join(home, '.omp', 'agent', 'mcp.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { headroom: { command: 'headroom' } } }), 'utf8');
    expect(ensureTersioMcp('omp')).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(data.mcpServers.headroom).toBeUndefined();
    expect(data.mcpServers.tersio).toBeDefined();
  });
});

test('opencode gets a local command entry but keeps its other servers', () => {
  withHome((home) => {
    const file = path.join(home, '.config', 'opencode', 'opencode.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcp: { other: { type: 'local', command: ['other'] } } }), 'utf8');
    expect(ensureTersioMcp('opencode')).toBe(true);
    expect(tersioMcpConfigured('opencode')).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8')) as { mcp: Record<string, unknown> };
    expect(data.mcp.other).toBeDefined();
    expect(data.mcp.tersio).toEqual({ type: 'local', command: [expect.stringMatching(/tersio(\.cmd|\.exe|\.js)?$/), 'mcp'], enabled: true });
    expect(removeTersioMcp('opencode')).toBe(true);
    expect(tersioMcpConfigured('opencode')).toBe(false);
  });
});

test('a malformed config is never overwritten', () => {
  withHome((home) => {
    const file = path.join(home, '.omp', 'agent', 'mcp.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ not json', 'utf8');
    expect(ensureTersioMcp('omp')).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });
});

test('an opencode .jsonc keeps its comments when the entry is added', () => {
  withHome((home) => {
    const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    mkdirSync(path.dirname(file), { recursive: true });
    const before = [
      '{',
      '  // the theme this user picked',
      '  "theme": "tersio",',
      '  "mcp": {',
      '    // a server Tersio must not touch',
      '    "other": { "type": "local", "command": ["other"] }',
      '  }',
      '}',
      '',
    ].join('\n');
    writeFileSync(file, before, 'utf8');
    expect(ensureTersioMcp('opencode')).toBe(true);
    const after = readFileSync(file, 'utf8');
    expect(after).toContain('// the theme this user picked');
    expect(after).toContain('// a server Tersio must not touch');
    const parsed = JSON.parse(after.replace(/^\s*\/\/.*$/gm, '')) as { mcp: Record<string, unknown> };
    expect(parsed.mcp.other).toBeDefined();
    expect(parsed.mcp.tersio).toBeDefined();
    expect(removeTersioMcp('opencode')).toBe(true);
    const removed = readFileSync(file, 'utf8');
    expect(removed).toContain('// the theme this user picked');
    expect(JSON.parse(removed.replace(/^\s*\/\/.*$/gm, ''))).toHaveProperty('mcp.other');
  });
});

test('a .jsonc without an mcp key gets one inserted after the root brace', () => {
  withHome((home) => {
    const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{\n  // only a theme\n  "theme": "tersio"\n}\n', 'utf8');
    expect(ensureTersioMcp('opencode')).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('// only a theme');
    const parsed = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as { theme: string; mcp: Record<string, unknown> };
    expect(parsed.theme).toBe('tersio');
    expect(parsed.mcp.tersio).toBeDefined();
  });
});

test('spliceTopLevelKey replaces only its own key', () => {
  const text = '{\n  "a": 1,\n  "mcp": { "x": true },\n  "b": [1, 2]\n}\n';
  const out = spliceTopLevelKey(text, 'mcp', { y: false });
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out as string) as Record<string, unknown>;
  expect(parsed.a).toBe(1);
  expect(parsed.mcp).toEqual({ y: false });
  expect(parsed.b).toEqual([1, 2]);
});

test('dsh reports the MCP entry its bundle already mounts', () => {
  withHome((home) => {
    expect(tersioMcpSupported('dsh')).toBe(false);
    expect(ensureTersioMcp('dsh')).toBe(false);
    expect(tersioMcpConfigured('dsh')).toBe(false);
    const file = path.join(home, '.dsh', 'profiles', 'web', 'package.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@krtclcdy/tersio'] } } }), 'utf8');
    expect(tersioMcpConfigured('dsh')).toBe(true);
  });
});

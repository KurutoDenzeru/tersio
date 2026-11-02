import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ensureTersioMcp, removeTersioMcp, tersioMcpConfigured, tersioMcpFile, tersioMcpSupported } from '../../extensions/shared/mcp-config.ts';
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
    expect(data.mcpServers.tersio).toEqual({ command: 'tersio', args: ['mcp'], enabled: true });
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
      expect(pi.mcpServers.tersio).toEqual({ command: 'tersio', args: ['mcp'], enabled: true });
      expect(pig.mcpServers.tersio).toEqual({ command: 'tersio', args: ['mcp'], enabled: true });
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
    expect(data.mcp.tersio).toEqual({ type: 'local', command: ['tersio', 'mcp'], enabled: true });
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

test('dsh has no MCP config Tersio writes', () => {
  expect(tersioMcpSupported('dsh')).toBe(false);
  expect(ensureTersioMcp('dsh')).toBe(false);
});

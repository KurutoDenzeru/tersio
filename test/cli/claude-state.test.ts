// The Claude Code plugin: what Tersio writes into the local marketplace, and how it reads the install back.
import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claudeLocalPluginFiles } from '../../extensions/shared/claude-plugin.ts';
import { CLAUDE_PLUGIN_FILES, CLAUDE_PLUGIN_ID, installedClaudePlugin } from '../../extensions/shared/claude-state.ts';

describe('claude plugin files', () => {
  test('the marketplace names the plugin and its relative source', () => {
    const files = claudeLocalPluginFiles();
    const market = JSON.parse(files['.claude-plugin/marketplace.json'] ?? '{}');
    expect(market.name).toBe('tersio');
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe('tersio');
    // A relative source resolves from the marketplace root, so it must start with ./
    expect(market.plugins[0].source).toBe('./tersio');
  });

  test('every file the installed plugin needs is written', () => {
    const files = claudeLocalPluginFiles();
    for (const rel of ['tersio/.claude-plugin/plugin.json', 'tersio/hooks/hooks.json', 'tersio/hooks/register.js']) {
      expect(files[rel], rel).toBeTruthy();
    }
    // A hooks module is what makes it a mod; a manifest alone draws nothing.
    const hooks = JSON.parse(files['tersio/hooks/hooks.json'] ?? '{}');
    expect(hooks.modules).toEqual(['./register.js']);
  });

  test('the version in the manifest is this build', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    const manifest = JSON.parse(claudeLocalPluginFiles()['tersio/.claude-plugin/plugin.json'] ?? '{}');
    expect(manifest.version).toBe(pkg.version);
  });
});

describe('installed claude plugin state', () => {
  test('a missing record reads as not installed', () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-none-'));
    try {
      process.env.CLAUDE_CONFIG_DIR = home;
      const state = installedClaudePlugin();
      expect(state.complete).toBe(false);
      expect(state.dir).toBeNull();
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a recorded plugin with every file reads as installed', () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-ok-'));
    try {
      process.env.CLAUDE_CONFIG_DIR = home;
      const dir = path.join(home, 'cache', 'tersio');
      for (const rel of CLAUDE_PLUGIN_FILES) {
        const at = path.join(dir, ...rel.split('/'));
        mkdirSync(path.dirname(at), { recursive: true });
        writeFileSync(at, '{}', 'utf8');
      }
      mkdirSync(path.join(home, 'plugins'), { recursive: true });
      writeFileSync(
        path.join(home, 'plugins', 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: { [CLAUDE_PLUGIN_ID]: [{ scope: 'user', installPath: dir, version: '1.0.0' }] },
        }),
        'utf8',
      );
      const state = installedClaudePlugin();
      expect(state.complete).toBe(true);
      expect(state.enabled).toBe(true);
      expect(state.version).toBe('1.0.0');
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a record whose files are gone reads as incomplete', () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-miss-'));
    try {
      process.env.CLAUDE_CONFIG_DIR = home;
      mkdirSync(path.join(home, 'plugins'), { recursive: true });
      writeFileSync(
        path.join(home, 'plugins', 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: { [CLAUDE_PLUGIN_ID]: [{ scope: 'user', installPath: path.join(home, 'gone') }] },
        }),
        'utf8',
      );
      const state = installedClaudePlugin();
      expect(state.complete).toBe(false);
      // Naming what is missing is what makes an install failure actionable.
      expect(state.missing.length).toBeGreaterThan(0);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a disabled plugin is not treated as installed', () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-off-'));
    try {
      process.env.CLAUDE_CONFIG_DIR = home;
      const dir = path.join(home, 'cache', 'tersio');
      for (const rel of CLAUDE_PLUGIN_FILES) {
        const at = path.join(dir, ...rel.split('/'));
        mkdirSync(path.dirname(at), { recursive: true });
        writeFileSync(at, '{}', 'utf8');
      }
      mkdirSync(path.join(home, 'plugins'), { recursive: true });
      writeFileSync(
        path.join(home, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { [CLAUDE_PLUGIN_ID]: [{ scope: 'user', installPath: dir }] } }),
        'utf8',
      );
      writeFileSync(
        path.join(home, 'settings.json'),
        JSON.stringify({ enabledPlugins: { [CLAUDE_PLUGIN_ID]: false } }),
        'utf8',
      );
      const state = installedClaudePlugin();
      expect(state.complete).toBe(true);
      expect(state.enabled).toBe(false);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

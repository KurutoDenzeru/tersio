import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CODEX_PLUGIN_FILES,
  CODEX_PROMPT_MARKER,
  CODEX_PROMPT_NAMES,
  applyCodexStopPatch,
  codexLocalPluginFiles,
  codexModeContext,
  codexPromptFiles,
  codexStopPatch,
  installedCodexPlugin,
} from '../../extensions/shared/codex-plugin.ts';
import { sessionsDirs } from '../../extensions/shared/usage-ledger.ts';
import { tersioMcpConfigured } from '../../extensions/shared/mcp-config.ts';
import { cliEnv, fakeExecutable, withHome } from '../helpers/env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer = path.join(root, 'dist', 'tersio.js');
const sourcePlugin = path.join(root, 'plugins', 'tersio');

function writePluginCache(codexHome: string, version = '2.25.18'): string {
  const dir = path.join(codexHome, 'plugins', 'cache', 'tersio', 'tersio', version);
  for (const rel of CODEX_PLUGIN_FILES) {
    const to = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    if (rel === 'plugin.json') {
      const manifest = JSON.parse(readFileSync(path.join(sourcePlugin, rel), 'utf8')) as Record<string, unknown>;
      writeFileSync(to, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`, 'utf8');
    } else {
      copyFileSync(path.join(sourcePlugin, ...rel.split('/')), to);
    }
  }
  return dir;
}

function writeFakeCodex(home: string): void {
  const bin = path.join(home, 'bin');
  const script = path.join(home, 'fake-codex.mjs');
  writeFileSync(script, `
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'plugin' && args[1] === 'add') {
  const home = process.env.HOME;
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const source = path.join(home, '.tersio', 'codex-marketplace', 'plugins', 'tersio');
  const version = JSON.parse(readFileSync(path.join(source, 'plugin.json'), 'utf8')).version;
  const dest = path.join(codexHome, 'plugins', 'cache', 'tersio', 'tersio', version);
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(path.join(codexHome, 'config.toml'), '[plugins."tersio@tersio"]\\nenabled = true\\n', 'utf8');
}
`, 'utf8');
  fakeExecutable(bin, 'codex', `exec "${process.execPath}" "${script}" "$@"`, `"${process.execPath}" "${script}" %*`);
}

test('the repo marketplace and portable plugin agree with the package', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
  const manifest = JSON.parse(readFileSync(path.join(sourcePlugin, 'plugin.json'), 'utf8')) as {
    name?: string;
    version?: string;
    extensions?: { 'com.openai'?: { hooks?: string } };
  };
  expect(manifest.name).toBe('tersio');
  expect(manifest.version).toBe(pkg.version);
  expect(manifest.extensions?.['com.openai']?.hooks).toBe('./hooks/hooks.json');
  expect(existsSync(path.join(sourcePlugin, '.codex-plugin', 'plugin.json'))).toBe(false);

  const marketplace = JSON.parse(readFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8')) as {
    name?: string;
    plugins?: Array<{ name?: string; source?: { path?: string } }>;
  };
  expect(marketplace.name).toBe('tersio');
  expect(marketplace.plugins?.[0]?.name).toBe('tersio');
  expect(marketplace.plugins?.[0]?.source?.path).toBe('./plugins/tersio');

  const hooks = JSON.parse(readFileSync(path.join(sourcePlugin, 'hooks', 'hooks.json'), 'utf8')) as {
    hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }> };
  };
  expect(hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe('tersio codex-hook user-prompt-submit');

  const mcp = JSON.parse(readFileSync(path.join(sourcePlugin, 'mcp.json'), 'utf8')) as {
    mcpServers?: { tersio?: { type?: string; command?: string; args?: string[] } };
  };
  expect(mcp.mcpServers?.tersio).toMatchObject({ type: 'stdio', command: 'tersio', args: ['mcp'] });
});

test('the installed prompts are Codex slash commands with managed markers', () => {
  const prompts = codexPromptFiles();
  expect(Object.keys(prompts).toSorted()).toEqual([...CODEX_PROMPT_NAMES].toSorted());
  for (const name of CODEX_PROMPT_NAMES) {
    const body = prompts[name];
    expect(body).toContain(CODEX_PROMPT_MARKER);
    expect(body).toMatch(new RegExp(`^---\\n[\\s\\S]*?description:[^\\n]+\\n[\\s\\S]*?---\\n`));
    expect(body).toContain('$ARGUMENTS');
    if (name !== 'tersio') expect(body).toMatch(/\$1/);
  }
});

test('the installed local marketplace pins absolute runtime and CLI paths', () => {
  const files = codexLocalPluginFiles('/usr/bin/node', '/opt/tersio/dist/tersio.js');
  const mcp = JSON.parse(files['plugins/tersio/mcp.json']) as {
    mcpServers?: { tersio?: { command?: string; args?: string[] } };
  };
  expect(mcp.mcpServers?.tersio).toMatchObject({
    command: '/usr/bin/node',
    args: ['/opt/tersio/dist/tersio.js', 'mcp'],
  });
  const hooks = JSON.parse(files['plugins/tersio/hooks/hooks.json']) as {
    hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }> };
  };
  expect(hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command)
    .toBe('"/usr/bin/node" "/opt/tersio/dist/tersio.js" codex-hook user-prompt-submit');
  const marketplace = JSON.parse(files['.agents/plugins/marketplace.json']) as {
    plugins?: Array<{ source?: { path?: string } }>;
  };
  expect(marketplace.plugins?.[0]?.source?.path).toBe('./plugins/tersio');
});

test('Codex detects the enabled plugin cache and its bundled MCP entry', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-codex-detect-'));
  const codexHome = path.join(home, '.codex');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const dir = writePluginCache(codexHome, '9.8.7');
    writeFileSync(path.join(codexHome, 'config.toml'), '[plugins."tersio@tersio"]\nenabled = true\n', 'utf8');
    const state = installedCodexPlugin();
    expect(state).toMatchObject({ dir, version: '9.8.7', complete: true, enabled: true, missing: [] });
    expect(tersioMcpConfigured('codex')).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex mode context follows its own host scope and stop phrases clear that scope', () => {
  withHome((home) => {
    const settings = path.join(home, '.tersio', 'settings.json');
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(settings, JSON.stringify({
      cavemanDefault: 'ultra',
      ponytailDefault: 'ultra',
      pstackDefault: 'on',
      hosts: { codex: { cavemanDefault: 'lite', ponytailDefault: 'off', pstackDefault: 'off' } },
    }), 'utf8');
    const context = codexModeContext();
    expect(context).toMatch(/Caveman lite active/);
    expect(context).not.toMatch(/PONYTAIL MODE ACTIVE/);
    expect(context).not.toMatch(/pstack mode active/);

    const patch = codexStopPatch('normal mode.');
    expect(patch).toEqual({ cavemanDefault: 'off', ponytailDefault: 'off', pstackDefault: 'off' });
    applyCodexStopPatch(patch!);
    const stored = JSON.parse(readFileSync(settings, 'utf8')) as { hosts?: { codex?: Record<string, string> } };
    expect(stored.hosts?.codex).toMatchObject({ cavemanDefault: 'off', ponytailDefault: 'off', pstackDefault: 'off' });
    expect(codexStopPatch('add normal mode to the design')).toBeNull();
  });
});

test('the Codex hook emits developer context and clears a stop phrase', () => {
  withHome((home) => {
    const settings = path.join(home, '.tersio', 'settings.json');
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(settings, JSON.stringify({
      hosts: { codex: { cavemanDefault: 'lite', ponytailDefault: 'off', pstackDefault: 'off' } },
    }), 'utf8');
    const env = { ...cliEnv(home), TERSIO_RUNTIME: 'node' };
    const hook = spawnSync(process.execPath, [installer, 'codex-hook', 'user-prompt-submit'], {
      encoding: 'utf8',
      env,
      input: JSON.stringify({ prompt: 'normal mode' }),
    });
    expect(hook.status, hook.stderr).toBe(0);
    expect(JSON.parse(hook.stdout)).toEqual({ continue: true });
    const stored = JSON.parse(readFileSync(settings, 'utf8')) as { hosts?: { codex?: Record<string, string> } };
    expect(stored.hosts?.codex?.cavemanDefault).toBe('off');
  });
});

test('Codex sessions join the shared usage scan', () => {
  withHome((home) => {
    const dir = path.join(home, '.codex', 'sessions', '2026', '11', '08');
    mkdirSync(dir, { recursive: true });
    expect(sessionsDirs()).toContain(path.join(home, '.codex', 'sessions'));
  });
});

test('Codex install writes slash prompts and uninstall removes only managed copies', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-codex-prompts-'));
  writeFakeCodex(home);
  const env = cliEnv(home, { PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`, TERSIO_RUNTIME: 'node' });
  delete env.CODEX_HOME;
  try {
    const install = spawnSync(process.execPath, [installer, 'install', '--host', 'codex', '--yes'], { encoding: 'utf8', env });
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
    for (const name of CODEX_PROMPT_NAMES) {
      const file = path.join(home, '.codex', 'prompts', `${name}.md`);
      expect(readFileSync(file, 'utf8')).toContain(CODEX_PROMPT_MARKER);
    }

    // A user-owned prompt with a Tersio name stays untouched.
    const custom = path.join(home, '.codex', 'prompts', 'custom.md');
    writeFileSync(custom, '# my prompt\n', 'utf8');
    const remove = spawnSync(process.execPath, [installer, 'uninstall', '--host', 'codex', '--yes'], { encoding: 'utf8', env });
    expect(remove.status, `${remove.stdout}\n${remove.stderr}`).toBe(0);
    for (const name of CODEX_PROMPT_NAMES) {
      expect(existsSync(path.join(home, '.codex', 'prompts', `${name}.md`))).toBe(false);
    }
    expect(existsSync(custom)).toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the modes command reads and writes the Codex host scope', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-codex-modes-'));
  const env = cliEnv(home, { TERSIO_RUNTIME: 'node' });
  try {
    const save = spawnSync(process.execPath, [installer, 'modes', 'combo', 'lite', '--host', 'codex'], { encoding: 'utf8', env });
    expect(save.status, save.stderr).toBe(0);
    const settings = path.join(home, '.tersio', 'settings.json');
    const stored = JSON.parse(readFileSync(settings, 'utf8')) as {
      hosts?: { codex?: Record<string, string | boolean> };
    };
    expect(stored.hosts?.codex).toMatchObject({
      comboDefault: 'lite',
      cavemanDefault: 'lite',
      rtkDefault: true,
      ponytailDefault: 'lite',
    });

    const status = spawnSync(process.execPath, [installer, 'modes', 'caveman', 'status', '--host', 'codex'], { encoding: 'utf8', env });
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/Caveman/i);
    expect(status.stdout).toMatch(/lite/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('install and uninstall preview the Codex marketplace commands', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-codex-lifecycle-'));
  const bin = path.join(home, 'bin');
  fakeExecutable(bin, 'codex', 'exit 0', 'exit /b 0');
  const env = cliEnv(home, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, TERSIO_RUNTIME: 'node' });
  try {
    const install = spawnSync(process.execPath, [installer, 'install', '--host', 'codex', '--dry-run', '--yes'], {
      encoding: 'utf8',
      env,
    });
    expect(install.status, install.stderr).toBe(0);
    expect(install.stdout).toMatch(/would run: codex plugin marketplace add .*tersio/);
    expect(install.stdout).toMatch(/would run: codex plugin add tersio@tersio/);

    const codexHome = path.join(home, '.codex');
    writePluginCache(codexHome);
    writeFileSync(path.join(codexHome, 'config.toml'), '[plugins."tersio@tersio"]\nenabled = true\n', 'utf8');
    const remove = spawnSync(process.execPath, [installer, 'uninstall', '--host', 'codex', '--dry-run'], {
      encoding: 'utf8',
      env,
    });
    expect(remove.status, remove.stderr).toBe(0);
    expect(remove.stdout).toMatch(/would run: codex plugin remove tersio@tersio/);
    expect(remove.stdout).toMatch(/would run: codex plugin marketplace remove tersio/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// OpenCode plugin entry: maps its plugin API onto the shared ExtensionApi the mode extensions consume.
import { execFile } from 'node:child_process';
import type { Plugin } from '@opencode/plugin';
import cavemanSessionExtension from '../caveman-session/index.ts';
import rtkSessionExtension from '../rtk-session/index.ts';
import comboToggleExtension from '../combo-toggle/index.ts';
import tersioCommandsExtension from '../tersio-commands/index.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

interface CommandConfig {
  description: string;
  handler: (args: string, ctx: ExtensionCtx) => Promise<void>;
}

interface ToolConfig {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: { args: string[] },
    signal: AbortSignal | undefined,
    onUpdate: ((data: unknown) => void) | undefined,
    ctx: ExtensionCtx | undefined,
  ) => Promise<{ isError: boolean; content: { type: string; text: string }[]; details: Record<string, unknown> }>;
}

// Plain object, not Plugin.define: define is an identity wrapper, and a value
// import would force every install to vendor the whole @opencode dependency tree.
const plugin: Plugin.Plugin = {
  id: 'tersio',
  async setup(ctx) {
    const entries: SessionEntry[] = ((await ctx.storage.get('entries')) as SessionEntry[] | undefined) ?? [];
    const persist = (): void => { void ctx.storage.set('entries', entries as unknown as never).catch(() => {}); };
    const stubCtx = (): ExtensionCtx => ({
      hasUI: false,
      cwd: ctx.location.directory,
      sessionManager: { getBranch: () => entries, getEntries: () => entries },
    });
    const commands = new Map<string, CommandConfig>();
    const tools = new Map<string, ToolConfig>();
    const beforeStart: Array<(event: SystemPromptEvent, ctx: ExtensionCtx) => unknown> = [];
    const inputHandlers: Array<(event: InputEvent) => unknown> = [];
    const lifecycle = new Map<string, Array<(event: unknown, ctx: ExtensionCtx) => unknown>>();

    const host: ExtensionApi = {
      hostId: 'opencode',
      setLabel() {},
      registerCommand(name, config) { commands.set(name, config); },
      registerTool(tool) { tools.set(tool.name, tool as ToolConfig); },
      appendEntry(type, data) { entries.push({ type: 'custom', customType: type, data }); persist(); },
      exec: (cmd, args, opts) => new Promise((resolve) => {
        execFile(cmd, args, { signal: opts?.signal, cwd: opts?.cwd }, (error, stdout, stderr) => {
          const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 0;
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code, killed: !!(error as { killed?: boolean } | null)?.killed });
        });
      }),
      cwd: ctx.location.directory,
      on: (event, handler) => {
        if (event === 'before_agent_start') { beforeStart.push(handler as (event: SystemPromptEvent, ctx: ExtensionCtx) => unknown); return; }
        if (event === 'input') { inputHandlers.push(handler as (event: InputEvent) => unknown); return; }
        const list = lifecycle.get(event) ?? [];
        list.push(handler as (event: unknown, ctx: ExtensionCtx) => unknown);
        lifecycle.set(event, list);
      },
    };

    for (const extension of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension, tersioCommandsExtension]) extension(host);

    // OpenCode has no session_start event surfaced to plugins, so restore once at setup.
    for (const handler of lifecycle.get('session_start') ?? []) await handler({}, stubCtx());

    await ctx.command.transform((editor) => {
      for (const [name, config] of commands) {
        editor.add({
          name,
          description: config.description,
          execute: async (input) => {
            const text = typeof input.prompt?.text === 'string' ? input.prompt.text : '';
            const args = text.includes(' ') ? text.slice(text.indexOf(' ') + 1).trim() : '';
            await config.handler(args, stubCtx());
          },
        });
      }
    });

    await ctx.tool.transform((editor) => {
      for (const tool of tools.values()) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
          execute: async (input) => {
            const args = Array.isArray((input as { args?: unknown }).args) ? ((input as { args: string[] }).args) : [];
            const result = await tool.execute('t', { args }, undefined, undefined, stubCtx());
            return { content: result.content.map((part) => part.text).join('\n') };
          },
        });
      }
    });

    await ctx.session.hook('context', async (event) => {
      const systemParts = event.system.map((part) => (part.type === 'text' ? part.text : '')).filter(Boolean);
      for (const handler of beforeStart) {
        const result = await handler({ systemPrompt: [...systemParts] } as SystemPromptEvent, stubCtx());
        if (!result || typeof result !== 'object' || !('systemPrompt' in result)) continue;
        const parts = typeof (result as { systemPrompt: unknown }).systemPrompt === 'string'
          ? [(result as { systemPrompt: string }).systemPrompt]
          : Array.isArray((result as { systemPrompt: unknown }).systemPrompt)
            ? (result as { systemPrompt: string[] }).systemPrompt
            : [];
        for (const part of parts) {
          if (!systemParts.includes(part)) event.system.push({ type: 'text', text: part });
        }
      }
    });

    await ctx.session.hook('prompt', (event) => {
      for (const handler of inputHandlers) void handler({ text: event.prompt.text, source: 'interactive' });
    });
  },
};

export default plugin;

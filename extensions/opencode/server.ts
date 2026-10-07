// OpenCode plugin entry: maps its plugin API onto the shared ExtensionApi the mode extensions consume.
import { execFile } from 'node:child_process';
import type { Plugin } from '@opencode/plugin';
import cavemanSessionExtension from '../caveman-session/index.ts';
import rtkSessionExtension from '../rtk-session/index.ts';
import rtkFilterExtension, { FILTER_BY_TOOL, MIN_FILTER_BYTES, filterThroughRtk, filterableText, rtkActive } from '../rtk-filter/index.ts';
import comboToggleExtension from '../combo-toggle/index.ts';
import tersioCommandsExtension from '../tersio-commands/index.ts';
import { getSharedComboState } from '../shared/session-state.ts';
import { formatStatus } from '../shared/status.ts';
import { resolveRtkBinary } from '../lib/utils.ts';
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

// The npm name, so the plugin list reads the same as the OMP and pi installs.
const plugin: Plugin.Plugin = {
  id: '@krtclcdy/tersio',
  async setup(ctx) {
    // Entries are scoped per session; an unseen ID restores on its first hook.
    const sessions = new Map<string, SessionEntry[]>();
    const started = new Map<string, Promise<void>>();
    let activeSid: string | undefined;
    const loadEntries = async (sid: string): Promise<SessionEntry[]> => {
      const own = ((await ctx.storage.get(`entries:${sid}`)) as SessionEntry[] | undefined) ?? [];
      if (own.length) return own;
      // Pre-scoped installs kept one global list; adopt it once, then diverge.
      // Clear it after adoption so it can never shadow saved defaults later.
      const legacy = ((await ctx.storage.get('entries')) as SessionEntry[] | undefined) ?? [];
      if (legacy.length) void ctx.storage.set('entries', []).catch(() => {});
      return [...legacy];
    };
    const sessionEntriesOf = (sid: string): SessionEntry[] => {
      let list = sessions.get(sid);
      if (!list) {
        list = [];
        sessions.set(sid, list);
      }
      return list;
    };
    const persist = (sid: string): void => {
      // SAFETY: the storage API is generic over its payload; the value round-trips unchanged.
      void ctx.storage.set(`entries:${sid}`, sessionEntriesOf(sid) as unknown as never).catch(() => {});
    };
    const stubCtx = (sid?: string): ExtensionCtx => ({
      hasUI: false,
      cwd: ctx.location.directory,
      sessionManager: sid === undefined
        ? { getBranch: () => [], getEntries: () => [] }
        : {
          getBranch: () => sessionEntriesOf(sid),
          getEntries: () => sessionEntriesOf(sid),
        },
    });
    // Starts are chained so appends land in the calling session.
    let startQueue = Promise.resolve();
    const runSessionStart = (sid: string): void => {
      const prev = started.get(sid);
      if (prev) return;
      const run = startQueue.then(async () => {
        for (const row of await loadEntries(sid)) sessionEntriesOf(sid).push(row);
        activeSid = sid;
        try {
          for (const handler of lifecycle.get('session_start') ?? []) await handler({}, stubCtx(sid));
        } finally {
          persist(sid);
          activeSid = undefined;
        }
      }).catch(() => {});
      started.set(sid, run);
      startQueue = run;
    };
    const ensureSession = (sid: string): Promise<void> => {
      runSessionStart(sid);
      return started.get(sid) ?? Promise.resolve();
    };
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
      appendEntry(type, data) {
        if (activeSid === undefined) return;
        sessionEntriesOf(activeSid).push({ type: 'custom', customType: type, data });
        persist(activeSid);
      },
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

    for (const extension of [cavemanSessionExtension, rtkSessionExtension, rtkFilterExtension, comboToggleExtension, tersioCommandsExtension]) extension(host);

    // The first hook of an unseen session runs its session_start handlers.
    const sidOf = (value: unknown): string | undefined =>
      typeof value === 'string' && value ? value : undefined;

    await ctx.command.transform((editor) => {
      for (const [name, config] of commands) {
        editor.add({
          name,
          description: config.description,
          execute: async (input) => {
            const sid = sidOf((input as { sessionID?: unknown }).sessionID);
            if (sid) await ensureSession(sid);
            const text = typeof input.prompt?.text === 'string' ? input.prompt.text : '';
            const args = text.includes(' ') ? text.slice(text.indexOf(' ') + 1).trim() : '';
            // The shared handlers report through ui.notify, which has no OpenCode
            // surface. Collect it and send it back so a command never answers blank.
            const notes: string[] = [];
            const cmdCtx: ExtensionCtx = {
              ...stubCtx(sid),
              hasUI: true,
              ui: { notify: (message: string) => { notes.push(message); } },
            };
            const prev = activeSid;
            activeSid = sid;
            try {
              await config.handler(args, cmdCtx);
            } finally {
              activeSid = prev;
            }
            const reply = notes.length ? notes.join('\n') : formatStatus(getSharedComboState());
            await ctx.session.prompt({ sessionID: input.sessionID, text: reply });
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
      const sid = sidOf((event as { sessionID?: unknown }).sessionID);
      if (sid) await ensureSession(sid);
      const systemParts = event.system.map((part) => (part.type === 'text' ? part.text : '')).filter(Boolean);
      for (const handler of beforeStart) {
        const result = await handler({ systemPrompt: [...systemParts] } as SystemPromptEvent, stubCtx(sid));
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

    await ctx.session.hook('prompt', async (event) => {
      const sid = sidOf((event as { sessionID?: unknown }).sessionID);
      if (sid) await ensureSession(sid);
      for (const handler of inputHandlers) void handler({ text: event.prompt.text, source: 'interactive' });
    });

    // rtk has its own OpenCode plugin; doing this here keeps one entry in the plugin list.
    await ctx.tool.hook('execute.before', async (event) => {
      const tool = String(event.tool ?? '').toLowerCase();
      if (tool !== 'bash' && tool !== 'shell') return;
      const input = event.input as { command?: unknown } | null | undefined;
      if (typeof input?.command !== 'string' || !input.command) return;
      const rewritten = await rewriteCommand(input.command);
      if (rewritten) input.command = rewritten;
    });

    // Built-in grep and glob output never reaches the bash hook; mutate result.content in place.
    try {
      await ctx.tool.hook('execute.after', async (event) => {
        const hook = event as { tool?: unknown; status?: unknown; sessionID?: unknown; result?: { content?: unknown } };
        if (hook.status !== 'completed') return;
        const filter = FILTER_BY_TOOL.get(String(hook.tool ?? '').toLowerCase());
        if (!filter || !hook.result) return;
        const text = filterableText(hook.result.content);
        if (text === null || text.length < MIN_FILTER_BYTES) return;
        // Read the mode from the payload's own session, not the last one to run a start hook.
        const sid = typeof hook.sessionID === 'string' ? hook.sessionID : activeSid;
        if (sid !== undefined) await ensureSession(sid);
        if (!rtkActive(sid === undefined ? undefined : sessionEntriesOf(sid))) return;
        const bin = resolveRtkBinary();
        if (!bin) return;
        const filtered = await filterThroughRtk(execRtk, { bin, filter, text });
        if (filtered) hook.result.content = [{ type: 'text', text: filtered }];
      });
    } catch {
      // Hosts without the after-hook keep the unfiltered result.
    }
  },
};

/** execFile with the promise shape `filterThroughRtk` expects. */
function execRtk(cmd: string, args: string[], opts?: { signal?: AbortSignal; timeout?: number }): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { signal: opts?.signal, timeout: opts?.timeout }, (error, stdout) => {
      const out = stdout ?? '';
      if (!error) return resolve({ stdout: out, code: 0 });
      // A non-numeric code is a spawn failure (ENOENT, EACCES, killed) and must not read as success.
      const raw = (error as { code?: unknown }).code;
      resolve({ stdout: out, code: typeof raw === 'number' ? raw : 1 });
    });
  });
}

function rewriteCommand(command: string): Promise<string | null> {
  const bin = resolveRtkBinary();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(bin, ['rewrite', command], { timeout: 5000 }, (error, stdout) => {
      // A kill or timeout means untrustworthy output; pass the command through.
      const err = error as { killed?: boolean; signal?: unknown } | null;
      if (err && (err.killed || err.signal)) return resolve(null);
      const out = String(stdout).trim();
      resolve(out && out !== command ? out : null);
    });
  });
}

export default plugin;

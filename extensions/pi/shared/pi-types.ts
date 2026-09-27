// extensions/pi/shared/types.ts — structural subset of Pi's ExtensionAPI.
//
// Pi has no build step and no published type package we can depend on inside
// the user's config dir, so the surface is described here the same way
// extensions/shared/types.ts describes OMP's. Every shape below is a subset of
// pi-coding-agent's core/extensions/types.ts, which is the authority; the
// comments cite the members this package actually touches.
//
// Deliberately separate from extensions/shared/types.ts: the two hosts disagree
// on prompt injection, tool schemas, and how an extension names itself, and
// one structural type covering both would hide exactly the places the ports
// must differ.

/** A custom session entry. Pi keeps these out of the model's context. */
export type SessionEntry = {
  type: string;
  customType?: string;
  data?: {
    mode?: string;
    enabled?: boolean;
    level?: string;
    [key: string]: unknown;
  };
};

/** `ctx.ui` as this package uses it. Pi's ExtensionUIContext. */
export interface UiApi {
  /** Pi takes plain strings, not `{label, description}` objects. */
  select?: (title: string, options: string[], opts?: Record<string, unknown>) => Promise<string | undefined>;
  setStatus?: (key: string, text: string | undefined) => void;
  notify?: (message: string, type?: 'info' | 'warning' | 'error') => void;
  theme?: {
    fg?: (role: string, text: string) => string;
  };
}

/** `ExtensionContext` in Pi. There is no `pi.cwd`; the cwd is on the context. */
export interface ExtensionCtx {
  /** Use "tui" to guard terminal-only UI; `hasUI` is true in TUI and RPC. */
  mode?: 'tui' | 'rpc' | 'json' | 'print';
  hasUI?: boolean;
  cwd?: string;
  sessionManager?: {
    getBranch?: () => SessionEntry[];
    getEntries?: () => SessionEntry[];
  };
  ui?: UiApi;
}

/** `ExtensionCommandContext` — an ExtensionContext plus command-only controls. */
export interface ExtensionCommandCtx extends ExtensionCtx {
  /** Reloads extensions, skills, prompts, and context files. */
  reload?: () => Promise<void>;
}

/** `BeforeAgentStartEvent.systemPromptOptions.sections` — the injection point. */
export interface PiPromptSections {
  [section: string]: unknown;
}

export interface PiBeforeAgentStartEvent {
  type?: string;
  /** Rendered prompt, read-only. Returning it would replace the whole prompt. */
  systemPrompt?: string;
  /** Mutable. Sections are wrapped in matching XML tags when non-empty. */
  systemPromptOptions?: {
    sections?: PiPromptSections;
    promptGuidelines?: unknown;
  } | null;
}

export interface PiInputEvent {
  type?: string;
  text?: string;
  source?: string;
}

export interface PiToolContent {
  type: 'text';
  text: string;
}

export interface PiToolResult {
  content: PiToolContent[];
  details?: Record<string, unknown>;
}

export interface PiExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export interface PiExecOptions {
  signal?: AbortSignal;
  timeout?: number;
  cwd?: string;
}

/**
 * `registerTool` parameters, structurally.
 *
 * Pi's ToolDefinition requires `parameters: TSchema` from typebox, which is
 * host-provided and only resolvable at Pi load time. The Pi rtk port therefore
 * builds its schema with a local JSON-Schema-shaped object and casts once here,
 * rather than adding a typebox dependency this package cannot install.
 */
export interface PiToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: PiToolParameters;
  execute: (
    toolCallId: string,
    params: { args: string[] },
    signal: AbortSignal | undefined,
    onUpdate: ((data: PiToolResult) => void) | undefined,
    ctx: ExtensionCtx | undefined,
  ) => Promise<PiToolResult>;
}

export interface PiCommandOptions {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandCtx) => void | Promise<void>;
}

/** `ExtensionAPI` as this package uses it. Every member is optional. */
export interface PiExtensionAPI {
  on?: (event: string, handler: (event: unknown, ctx: ExtensionCtx) => unknown) => (() => void) | void;
  registerCommand?: (name: string, options: PiCommandOptions) => void;
  registerTool?: (tool: PiToolDefinition) => void;
  /** Appends a custom entry, excluded from the model's context. */
  appendEntry?: (customType: string, data: Record<string, unknown>) => void;
  exec?: (command: string, args: string[], options?: PiExecOptions) => Promise<PiExecResult>;
}

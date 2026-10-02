// Shared OMP extension host types. Structural — the real `pi` object comes from the OMP runtime; these describe the surface this package touches.

export interface ComboState {
  level: string;
  caveman: string;
  rtk: string;
  ponytail: string;
}

export type ComboLevel = 'off' | 'medium' | 'balanced' | 'max' | 'custom';

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

export interface UiApi {
  select?: (
    title: string,
    options: Array<string | { label: string; description?: string }>,
    dialogOptions?: Record<string, unknown>,
  ) => Promise<string | undefined>;
  setStatus?: (name: string, value: string | undefined) => void;
  notify?: (message: string, level?: string) => void;
  theme?: {
    fg?: (role: string, text: string) => string;
  };
}

export interface ExtensionCtx {
  hasUI?: boolean;
  cwd?: string;
  sessionManager?: {
    getBranch?: () => SessionEntry[];
    getEntries?: () => SessionEntry[];
  };
  ui?: UiApi;
  reload?: () => Promise<void>;
}

export interface SystemPromptEvent {
  systemPrompt: string | string[];
  // pi only: the mutable prompt sections. OMP does not provide it.
  systemPromptOptions?: { appendSystemPrompt?: string };
}

/** What a `before_agent_start` handler hands back. OMP takes an array, pi a string. */
export type PromptInjection = { systemPrompt: string[] } | { systemPrompt: string };

/** A tool `parameters` object. OMP wants zod, pi wants JSON Schema. */
export type ToolParams = Record<string, unknown>;

export interface InputEvent {
  text?: string;
  source?: string;
}

export interface ExtensionApi {
  setLabel?: (label: string) => void;
  registerCommand?: (name: string, config: {
    description: string;
    handler: (args: string, ctx: ExtensionCtx) => Promise<void>;
  }) => void;
  registerTool?: (tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (
      toolCallId: string,
      params: { args: string[] },
      signal: AbortSignal | undefined,
      onUpdate: ((data: unknown) => void) | undefined,
      ctx: ExtensionCtx | undefined,
    ) => Promise<{
      isError: boolean;
      content: { type: string; text: string }[];
      details: Record<string, unknown>;
    }>;
  }) => void;
  appendEntry?: (customType: string, data: Record<string, unknown>) => void;
  exec?: (cmd: string, args: string[], opts?: { signal?: AbortSignal; cwd?: string }) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
    killed?: boolean;
  }>;
  cwd?: string;
  zod?: { z: unknown };
  on<E>(event: string, handler: (event: E, ctx: ExtensionCtx) => unknown): void;}

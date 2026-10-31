// Ponytail as a pi extension: the /ponytail command, the skill aliases, and the system-prompt injection.
import {
  DEFAULT_MODE,
  RUNTIME_MODES,
  getDefaultMode,
  getHideStatus,
  getQuietStartup,
  isDeactivationCommand,
  normalizeMode,
  normalizePersistedMode,
  writeDefaultMode,
} from "../hooks/ponytail-config.ts";
import { filterSkillBodyForMode, getPonytailInstructions } from "../hooks/ponytail-instructions.ts";

export { filterSkillBodyForMode };
export const readDefaultMode = getDefaultMode;
export const readQuietStartup = getQuietStartup;

const RUNTIME_MODE_LIST = RUNTIME_MODES.join("|");
const PONYTAIL_COMMAND_DESCRIPTION = `Set mode: ${RUNTIME_MODE_LIST}. Commands: status, default <mode>`;

/** The slice of pi's API the extension touches; jiti hands the real object across at load time. */
interface PonytailApi {
  appendEntry: (type: string, data: unknown) => void;
  sendUserMessage: (text: string, options?: { expandPromptTemplates?: boolean; deliverAs?: string }) => void;
  registerCommand: (name: string, config: {
    description: string;
    getArgumentCompletions?: (prefix: string) => unknown;
    handler: (args: string, ctx: PonytailCtx) => void | Promise<void>;
  }) => void;
  on: (event: string, handler: (event: PonytailEvent, ctx: PonytailCtx) => unknown) => void;
}

interface PonytailUi {
  setStatus?: (id: string, value: string | undefined) => void;
  notify?: (message: string, level?: string) => void;
  theme?: { fg?: (slot: string, text: string) => string };
}

interface PonytailCtx {
  ui?: PonytailUi;
  isIdle?: () => boolean;
  sessionManager?: { getBranch?: () => unknown; getEntries?: () => unknown };
}

interface PonytailEvent {
  source?: string;
  text?: unknown;
  systemPrompt?: unknown;
  systemPromptOptions?: { sections?: Record<string, string> };
}

interface SessionEntry {
  type?: unknown;
  customType?: unknown;
  data?: { mode?: unknown };
}

// Every item is a complete command: pi submits on Enter, so a bare "default" would run without a mode. Values only: per-level descriptions would be a second copy of the Levels table in SKILL.md.
export function completePonytailArgs(prefix: unknown): Array<{ value: string; label: string }> | null {
  const typed = String(prefix || "").trimStart();
  const values = [...RUNTIME_MODES, "status", ...RUNTIME_MODES.map((m) => `default ${m}`)].filter((v) => v.startsWith(typed));
  return values.length ? values.map((value) => ({ value, label: value })) : null;
}

export function resolveSessionMode(entries: unknown, fallbackMode: string = DEFAULT_MODE): string {
  const fallback = normalizePersistedMode(fallbackMode) || DEFAULT_MODE;
  if (!Array.isArray(entries)) return fallback;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as SessionEntry;
    if (entry?.type !== "custom" || entry?.customType !== "ponytail-mode") continue;

    const mode = normalizePersistedMode(entry?.data?.mode);
    if (mode) return mode;
  }

  return fallback;
}

export type ParsedPonytailCommand =
  | { type: "status" }
  | { type: "set-mode"; mode: string }
  | { type: "set-default"; mode: string }
  | { type: "invalid"; reason: string; mode?: string };

export function parsePonytailCommand(text: unknown, defaultMode: string = DEFAULT_MODE, currentMode: string | null = null): ParsedPonytailCommand {
  const fallback = normalizePersistedMode(defaultMode) || DEFAULT_MODE;
  const normalizedText = String(text || "").trim().toLowerCase();

  if (!normalizedText) {
    // Bare /ponytail switches ponytail on, or reports the level when it already is (#639).
    if (currentMode && currentMode !== "off") return { type: "status" };
    return { type: "set-mode", mode: fallback === "off" ? "full" : fallback };
  }

  const [primary, secondary] = normalizedText.split(/\s+/);

  if (primary === "status") return { type: "status" };

  if (primary === "default") {
    // ponytail: a default must be a runtime level; review is session-only (#377).
    const mode = normalizeMode(secondary);
    return mode ? { type: "set-default", mode } : { type: "invalid", reason: "invalid-default-mode" };
  }

  const mode = normalizeMode(primary);
  return mode ? { type: "set-mode", mode } : { type: "invalid", reason: "invalid-mode", mode: primary };
}

export { writeDefaultMode };

export default function ponytailExtension(pi: PonytailApi): void {
  let currentMode = DEFAULT_MODE;
  let configuredDefaultMode = getDefaultMode();
  let hideStatus = getHideStatus();
  let isActive = false;
  let lastCtx: PonytailCtx | null = null;

  // -- Status bar --
  function syncStatus(ctx?: PonytailCtx | null): void {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    // ponytail: hide the indicator but keep the ruleset active (#324).
    if (hideStatus) return;
    if (!c?.ui?.setStatus) return;
    // ponytail: try/catch guards against pi-web theme proxy throwing before initTheme
    let theme: PonytailUi["theme"];
    try { theme = c.ui.theme; if (!theme?.fg) return; } catch { return; }
    if (currentMode === "off") {
      c.ui.setStatus("ponytail", undefined);
      return;
    }
    const levelIcons: Record<string, string> = { lite: "🌿", full: "⚡", ultra: "🔥" };
    const icon = levelIcons[currentMode] || "";
    const label = currentMode.toUpperCase();
    const indicator = isActive ? theme.fg("accent", "●") : theme.fg("dim", "○");
    c.ui.setStatus("ponytail", indicator + " 🐴 " + theme.fg("muted", "ponytail: ") + theme.fg("text", icon + " " + label));
  }

  const setMode = (mode: unknown, ctx?: PonytailCtx | null): void => {
    const normalized = normalizePersistedMode(mode);
    if (!normalized) return;

    currentMode = normalized;
    pi.appendEntry("ponytail-mode", { mode: normalized });
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Ponytail mode set to ${normalized}.`, "info");
  };

  const sendAlias = (skillName: string, args: unknown, ctx?: PonytailCtx | null): void => {
    const normalized = String(args || "").trim();
    const message = normalized ? `${skillName} ${normalized}` : skillName;

    // pi.sendUserMessage does not expand skill commands on its own, so without expandPromptTemplates the alias lands as the literal text "/skill:ponytail-review" and the skill body never reaches the agent.
    if (ctx?.isIdle?.() === false) {
      pi.sendUserMessage(message, { expandPromptTemplates: true, deliverAs: "followUp" });
      ctx?.ui?.notify?.(`${skillName} queued as follow-up.`, "info");
      return;
    }

    pi.sendUserMessage(message, { expandPromptTemplates: true });
  };

  pi.registerCommand("ponytail", {
    description: PONYTAIL_COMMAND_DESCRIPTION,
    getArgumentCompletions: (prefix) => completePonytailArgs(prefix),
    handler: async (args, ctx) => {
      const parsed = parsePonytailCommand(args, configuredDefaultMode, currentMode);

      if (parsed.type === "status") {
        ctx?.ui?.notify?.(`Ponytail: current ${currentMode} • default ${configuredDefaultMode}`, "info");
        return;
      }

      if (parsed.type === "set-default") {
        try {
          const written = writeDefaultMode(parsed.mode);
          if (written) {
            configuredDefaultMode = getDefaultMode();
            const message = configuredDefaultMode === written
              ? `Default Ponytail mode set to ${written}.`
              : `Saved default ${written}, but env override keeps default at ${configuredDefaultMode}.`;
            ctx?.ui?.notify?.(message, "info");
          }
        } catch (e) {
          ctx?.ui?.notify?.(`Failed to save default mode: ${(e as Error).message}`, "error");
        }
        return;
      }

      if (parsed.type === "set-mode") {
        setMode(parsed.mode, ctx);
        return;
      }

      ctx?.ui?.notify?.("Unknown or unsupported /ponytail mode.", "warning");
    },
  });

  pi.registerCommand("ponytail-review", {
    description: "Run /skill:ponytail-review",
    handler: (args, ctx) => sendAlias("/skill:ponytail-review", args, ctx),
  });

  pi.registerCommand("ponytail-audit", {
    description: "Run /skill:ponytail-audit",
    handler: (args, ctx) => sendAlias("/skill:ponytail-audit", args, ctx),
  });

  pi.registerCommand("ponytail-gain", {
    description: "Run /skill:ponytail-gain",
    handler: (args, ctx) => sendAlias("/skill:ponytail-gain", args, ctx),
  });

  pi.registerCommand("ponytail-debt", {
    description: "Run /skill:ponytail-debt",
    handler: (args, ctx) => sendAlias("/skill:ponytail-debt", args, ctx),
  });

  pi.registerCommand("ponytail-help", {
    description: "Run /skill:ponytail-help",
    handler: (args, ctx) => sendAlias("/skill:ponytail-help", args, ctx),
  });

  pi.on("input", async (event, ctx) => {
    if (event?.source === "extension") return;

    const text = String(event?.text || "");
    if (currentMode !== "off" && isDeactivationCommand(text)) {
      setMode("off", ctx);
    }
  });

  const restoreSessionMode = (ctx?: PonytailCtx | null): void => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
    currentMode = resolveSessionMode(entries, configuredDefaultMode);
    syncStatus(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    configuredDefaultMode = getDefaultMode();
    hideStatus = getHideStatus();
    restoreSessionMode(ctx);
    if (!getQuietStartup()) {
      ctx?.ui?.notify?.(`Ponytail loaded: ${currentMode}`, "info");
    }
  });

  // Both hosts emit session_tree. Pi re-emits session_start on /new, /resume and /fork; OMP emits session_switch and session_branch instead.
  for (const eventName of ["session_tree", "session_switch", "session_branch"]) {
    pi.on(eventName, async (_event, ctx) => {
      restoreSessionMode(ctx);
    });
  }

  pi.on("agent_start", async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (!currentMode || currentMode === "off") {
      // Clear a stale section when the mode is off so a previous turn does not linger (#953).
      if (event?.systemPromptOptions?.sections) delete event.systemPromptOptions.sections.ponytail;
      return;
    }
    const instructions = getPonytailInstructions(currentMode);
    // Prefer structured sections so Pi can keep the cached prefix when other extensions change their own section (#953). Fall back to replacement for older Pi versions without systemPromptOptions.sections.
    const sections = event?.systemPromptOptions?.sections;
    if (sections && typeof sections === "object") {
      sections.ponytail = instructions;
      return;
    }
    // OMP passes the system prompt as an array of parts; keep it one (#776).
    if (Array.isArray(event?.systemPrompt)) {
      return { systemPrompt: [...event.systemPrompt, instructions] };
    }
    // Guard a null/undefined event or a missing systemPrompt: don't crash, and don't prepend the literal string "undefined" to the prompt (#439, #440).
    const base = event?.systemPrompt ? `${String(event.systemPrompt)}\n\n` : "";
    return { systemPrompt: `${base}${instructions}` };
  });
}

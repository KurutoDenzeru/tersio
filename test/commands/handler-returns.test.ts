import { expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

// Both are needed: `os.homedir()` ignores HOME on macOS, so HOME alone still
// reads the developer's real ~/.tersio settings.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.TERSIO_HOME = process.env.HOME;

type Handler = (args: string, ctx: unknown) => Promise<unknown>;

const loadExtension = async (name: string) => {
  const url = new URL(`file:///${path.join(root, "extensions", name, "index.ts").replace(/\\/g, "/")}`);
  return (await import(url.href)).default as (pi: FakePi) => void;
};

// Every extension entry point, each registering exactly one command.
const EXTENSIONS = ["caveman-session", "combo-toggle", "rtk-session", "tersio-commands", "ai-addons-updater"] as const;

interface FakePi {
  commands: Map<string, Handler>;
  registerCommand(name: string, config: { handler: Handler }): void;
  registerTool(): void;
  registerShortcut(): void;
  registerFlag(): void;
  setLabel(): void;
  on(): void;
  exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  appendEntry(customType: string, data: Record<string, unknown>): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  ui: { notify(): void; select(): Promise<undefined> };
  events: { on(): void; emit(): void };
}

const createPi = (): FakePi => {
  const commands = new Map<string, Handler>();
  const noop = (): void => {};
  return {
    commands,
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool: noop,
    registerShortcut: noop,
    registerFlag: noop,
    setLabel: noop,
    on: noop as () => void,
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    appendEntry: noop as (customType: string, data: Record<string, unknown>) => void,
    cwd: root,
    env: { ...process.env },
    ui: { notify: noop, select: async () => undefined },
    events: { on: noop as () => void, emit: noop as () => void },
  };
};

const ctx = { hasUI: false, ui: { notify: (): void => {} }, cwd: root, sessionManager: { getBranch: () => [] } };

// A resolved value becomes a prompt and starts a model turn, so a handler that
// already printed everything must resolve undefined.
test("no tersio command handler resolves a value", async () => {
  const seen: string[] = [];
  for (const name of EXTENSIONS) {
    const install = await loadExtension(name);
    const pi = createPi();
    install(pi);
    for (const [command, handler] of pi.commands) {
      expect(await handler("", ctx), `/${command} in ${name} must resolve undefined`).toBeUndefined();
      seen.push(`/${command}`);
    }
  }
  expect(seen.length).toBe(EXTENSIONS.length);
});

// Cancelling the host must not roll the modes back, so every session entry is
// written before the status line goes out.
test("a combo change is persisted before the host is told about it", async () => {
  const install = await loadExtension("combo-toggle");
  const pi = createPi();
  const order: string[] = [];
  pi.appendEntry = (customType: string) => { order.push(`entry:${customType}`); };
  pi.ui.notify = (message: string) => { order.push(`notify:${message}`); };
  install(pi);

  await pi.commands.get("combo")?.("balanced", { ...ctx, hasUI: true, ui: pi.ui });

  // Every mode entry lands first, in the preset's own order.
  expect(order.slice(0, 4)).toEqual([
    "entry:caveman-mode",
    "entry:rtk-mode",
    "entry:ponytail-mode",
    "entry:combo-level",
  ]);
  // The host hears about it once, and only with the settled state.
  const notices = order.slice(4);
  expect(notices).toEqual(["notify:🧩 combo BALANCED: 🪨caveman=FULL ⚡rtk=ON 🦥ponytail=FULL"]);
});

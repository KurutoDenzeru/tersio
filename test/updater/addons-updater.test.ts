import { expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const updaterPath = path.join(root, "extensions", "ai-addons-updater", "index.ts");
const updaterUrl = new URL("file:///" + updaterPath.replace(/\\/g, "/"));

const { parseChecksum, default: updaterExtension } = await import(updaterUrl.href);

const HOME = os.homedir();
const PLUGINS_DIR = path.join(HOME, ".omp", "plugins");

interface FakePi {
  registerCommand(name: string, config: { handler: CommandHandler }): void;
  getHandler(): CommandHandler | null;
  setLabel(): void;
  exec(cmd: string, args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string; code: number }>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  ui: { notify(): void };
}

type CommandHandler = (args: string, ctx: FakeCtx) => Promise<string>;
type ExecMock = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string; code: number }>;

interface FakeCtx {
  cwd: string;
  ui: { notify(): void };
}

const createFakePi = (execMock: ExecMock): FakePi & { getHandler(): CommandHandler | null } => {
  let capturedHandler: CommandHandler | null = null;
  return {
    registerCommand: (name, config) => {
      if (name === "ai-addons") capturedHandler = config.handler;
    },
    getHandler: () => capturedHandler,
    setLabel: () => {},
    exec: execMock,
    cwd: PLUGINS_DIR,
    env: { ...process.env, HOME },
    ui: { notify: () => {} },
  };
};

const createFakeCtx = (): FakeCtx => ({ cwd: PLUGINS_DIR, ui: { notify: () => {} } });

test("parseChecksum returns lowercase 64-char hash for standard line with optional * and nested filename", () => {
  const checksums = `
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  *ponytail-1.2.3.tgz
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz
`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum accepts a checksum line without a star", () => {
  const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
});

test("parseChecksum matches a nested filename by basename", () => {
  const checksums = `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  some/nested/ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum normalizes uppercase hash to lowercase", () => {
  const checksums = `DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF  ponytail-1.2.3.tgz\n`;
  const hash = parseChecksum(checksums, "ponytail-1.2.3.tgz");
  expect(hash).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
});

test("parseChecksum returns null for malformed content and different asset", () => {
  const malformed = "not a valid checksum line\n";
  expect(parseChecksum(malformed, "ponytail-1.2.3.tgz")).toBe(null);

  const mismatched = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  other-package-1.0.0.tgz\n";
  expect(parseChecksum(mismatched, "ponytail-1.2.3.tgz")).toBe(null);
});

test("/ai-addons update ponytail reports the bundled copy without touching npm", async () => {
  const execCalls: { cmd: string; args: string[]; opts: { cwd: string } }[] = [];
  const execMock: ExecMock = async (cmd, args, opts) => {
    execCalls.push({ cmd, args, opts });
    return { stdout: "updated", stderr: "", code: 0 };
  };

  const fakePi = createFakePi(execMock);
  const fakeCtx = createFakeCtx();

  updaterExtension(fakePi);
  const handler = fakePi.getHandler();
  expect(handler, "ai-addons command handler not registered via registerCommand").toBeTruthy();

  const result = await handler("update ponytail", fakeCtx);

  expect(execCalls.length, "bundled ponytail must not shell out to npm").toBe(0);
  expect(String(result)).toMatch(/bundled with tersio/i);
  expect(String(result)).toMatch(/tersio update/);
});
test("/ai-addons update ponytail without host exec still reports the bundled copy", async () => {
  const fakePi = createFakePi(async () => ({ stdout: "", stderr: "", code: 0 }));
  delete (fakePi as Partial<FakePi>).exec;
  const fakeCtx = createFakeCtx();

  updaterExtension(fakePi);
  const handler = fakePi.getHandler();
  expect(handler, "ai-addons command handler not registered via registerCommand").toBeTruthy();

  const result = await handler("update ponytail", fakeCtx);
  expect(result).toMatch(/bundled with tersio/i);
});

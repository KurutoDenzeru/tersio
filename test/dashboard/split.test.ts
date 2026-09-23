import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILES = ["core.js", "charts.js", "settings.js", "share.js"];

interface StubEl {
  children: StubEl[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  classList: { add: () => void; remove: () => void; toggle: () => void; contains: () => boolean };
  addEventListener: () => void;
  appendChild: (c: StubEl) => StubEl;
  setAttribute: () => void;
  getAttribute: () => null;
  querySelector: () => StubEl;
  querySelectorAll: () => StubEl[];
  getBoundingClientRect: () => { bottom: number; right: number };
  closest: () => null;
  focus: () => void;
  click: () => void;
  remove: () => void;
  title: string;
  textContent: string;
  innerHTML: string;
}

function makeEl(): StubEl {
  return {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ bottom: 0, right: 0 }),
    closest: () => null,
    focus() {},
    click() {},
    remove() {},
    title: "",
    textContent: "",
    innerHTML: "",
  };
}

// Minimal browser surface: every dashboard file must evaluate and the full
// render must complete without throwing. Catches cross-file breakage from
// the core/charts/settings/share split (missing namespace entries, stale
// bare references) that tsc and node --check cannot see.
function boot(): Record<string, (...args: never[]) => unknown> {
  const els: Record<string, StubEl> = {};
  const sandbox: Record<string, unknown> = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { protocol: "http:" },
    addEventListener() {},
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    MutationObserver: function (this: unknown) {
      (this as { observe: () => void }).observe = () => {};
    },
    fetch: () => Promise.reject(new Error("stub")),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      getElementById: (id: string) => els[id] || (els[id] = makeEl()),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      addEventListener() {},
      hidden: false,
      documentElement: { scrollHeight: 0, setAttribute() {}, removeAttribute() {} },
      body: makeEl(),
    },
  };
  sandbox.window = sandbox;
  const names = Object.keys(sandbox);
  for (const file of FILES) {
    const code = readFileSync(path.join(root, "dashboard", file), "utf8");
    const run = new Function(...names, code) as (...args: unknown[]) => void;
    run(...names.map((n) => sandbox[n]));
  }
  return (sandbox.Tersio || {}) as Record<string, (...args: never[]) => unknown>;
}

test("dashboard files evaluate and expose the shared namespace", () => {
  const T = boot();
  for (const key of ["render", "renderMain", "load", "getData", "onRender", "dayTotal", "emptyState", "toast", "applyCurrency"]) {
    expect(typeof T[key], `Tersio.${key}`).toBe("function");
  }
});

test("dashboard full render completes against fixture data", () => {
  const T = boot();
  const render = T.render as (d: unknown) => void;
  expect(() => render({
    tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 0 },
    usd: 0.01, priced: true, savedUsd: 0.001, costMeasured: 0, co2g: 0.1, energyWh: 0.01,
    version: "x", currency: "USD", source: "live", messages: 2, byModel: {}, byModelMessages: {},
    byModelUsd: {}, byModelBucketUsd: {}, byDay: {}, byDayModel: {}, byTool: [], recent: [],
    rtkGain: { commands: 0 }, paths: {}, total: 0, byKind: {}, byDetail: [], lastWrite: null, empty: true,
  })).not.toThrow();
  expect((T.getData() as { messages: number }).messages).toBe(2);
});

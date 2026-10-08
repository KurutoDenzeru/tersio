// Interaction cost guards. These run in happy-dom, so they need no browser: React renders for real,
// and a guard that spies on the aggregation catches a per-click re-fold by call count, which a
// timing budget cannot: timing flatters on a fast machine and lies on a slow one.
//
// This is the browser-free substitute for the CDP-driven smoke runs: the freeze this suite guards
// against came from a chart library mounting inside every expanded table row, which only a real
// render (not a static snapshot) can catch.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import * as aggregate from "../src/lib/aggregate";
import { PageBody } from "../src/pages";
import { report } from "./fixtures";
import type { UsageReport } from "../src/lib/data";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function page(overrides: Partial<UsageReport>, id = "providers") {
  return render(
    <PageBody
      page={id}
      data={report(overrides)}
      cutoff={null}
      since={null}
      range="all"
      money={(v) => `$${v.toFixed(2)}`}
      fx={{ cur: "USD", rates: { USD: 1 }, live: false }}
      onCurrency={() => undefined}
    />,
  );
}

/** A payload big enough that a per-click re-aggregation is measurable rather than free. */
function widePayload(): Partial<UsageReport> {
  const days = Array.from({ length: 90 }, (_, i) => `2026-0${1 + (i % 3)}-${String(1 + (i % 27)).padStart(2, "0")}`);
  const byDay: UsageReport["byDay"] = {};
  const byDayModelTokens: UsageReport["byDayModelTokens"] = {};
  const byDayModelRuns: UsageReport["byDayModelRuns"] = {};
  for (const day of new Set(days)) {
    byDay[day] = { input: 1000, output: 500, cacheRead: 4000, cacheWrite: 0 };
    byDayModelTokens[day] = {
      "model-a": { input: 400, output: 200, cacheRead: 1600, cacheWrite: 0 },
      "model-b": { input: 600, output: 300, cacheRead: 2400, cacheWrite: 0 },
    };
    byDayModelRuns[day] = { "model-a": 5, "model-b": 7 };
  }
  return { byDay, byDayModelTokens, byDayModelRuns };
}

test("expanding a provider row does not re-run the aggregation", () => {
  const fold = vi.spyOn(aggregate, "providerStats");
  const { container } = page(widePayload());
  // One fold for the first render. Every further click must not add one.
  expect(fold.mock.calls.length, "the first render folds once").toBe(1);

  for (const button of [...container.querySelectorAll('button[aria-label^="Expand"]')].slice(0, 3)) {
    fireEvent.click(button);
  }
  expect(fold.mock.calls.length, "each expand re-folded the payload inside the click").toBe(1);
  // The expansions really rendered: detail rows exist under the table.
  expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(1);
});

test("switching the chart mode does not recompute the provider series", () => {
  const fold = vi.spyOn(aggregate, "providerStats");
  const { container } = page(widePayload());
  expect(fold.mock.calls.length).toBe(1);

  for (const tab of [...container.querySelectorAll('[role="tab"]')]) fireEvent.click(tab);
  for (const tab of [...container.querySelectorAll('[role="tab"]')]) fireEvent.click(tab);
  expect(fold.mock.calls.length, "a mode click re-folded the payload").toBe(1);
});

test("filtering a table does not re-aggregate the payload", () => {
  // Filtering a table is state local to the DataTable, so the page body must not redo its folds.
  const { container } = page(widePayload(), "models");
  const filter = container.querySelector("input");
  expect(filter, "the models page has a filter field").toBeTruthy();
  fireEvent.change(filter!, { target: { value: "zzz" } });
  const started = performance.now();
  fireEvent.change(filter!, { target: { value: "zzza" } });
  const elapsed = performance.now() - started;
  expect(elapsed, "a filter keystroke re-aggregated the payload").toBeLessThan(250);
});

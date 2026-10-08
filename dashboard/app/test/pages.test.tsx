// @vitest-environment happy-dom
// The sidebar and the router are two lists of the same thing, so a nav entry without a page would
// silently render the fallback. This walks every entry.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NAV_ITEMS } from "../src/components/app/nav";
import { PageBody } from "../src/pages";
import { report } from "./fixtures";
import type { UsageReport } from "../src/lib/data";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// recharts mounts a ResponsiveContainer, which happy-dom does not provide.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // The traces page reads the dashboard API on mount; the nav walk must not reach the network.
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(page: string, overrides: Partial<UsageReport> = {}): string {
  const { container } = render(
    <PageBody
      page={page}
      data={report(overrides)}
      cutoff={null}
      since={null}
      range="all"
      money={(v) => `$${v.toFixed(2)}`}
      fx={{ cur: "USD", rates: { USD: 1 }, live: false }}
      onCurrency={() => undefined}
    />,
  );
  return container.textContent ?? "";
}

test("every sidebar entry renders a real page", () => {
  expect(NAV_ITEMS.length).toBe(11);
  for (const item of NAV_ITEMS) {
    const text = renderPage(item.id);
    // The fallback names the missing page, so this catches a nav entry with no route.
    expect(text, `${item.id} rendered the unknown-page fallback`).not.toContain("No such page");
    expect(text.length, `${item.id} rendered nothing`).toBeGreaterThan(0);
    cleanup();
  }
});

test("an unknown page says so instead of rendering blank", () => {
  expect(renderPage("not-a-page")).toContain("No such page");
});

test("the traces page lists sessions from the server and says the range does not narrow them", async () => {
  renderPage("traces");
  // The list is empty in this stub, so the page must say so rather than render a blank table.
  expect(await screen.findByText("No sessions recorded")).toBeTruthy();
  expect(screen.getByText(/range picker does not narrow/)).toBeTruthy();
  expect(screen.getByLabelText("Search sessions")).toBeTruthy();
});

test("costs reports pricing coverage instead of one blended total", () => {
  const text = renderPage("costs");
  expect(text).toContain("API-equivalent");
  expect(text).toContain("1/1 models priced");
});

test("costs names the unpriced models it excluded", () => {
  const text = renderPage("costs", {
    priced: false,
    pricingCoverage: { priced: 1, total: 2 },
    unpriced: [{ model: "space-bunny", tokens: 900, messages: 3 }],
  });
  expect(text).toContain("1/2 models priced");
  expect(text).toContain("space-bunny");
});

test("models shows N/A for a model with no recorded time to first token", () => {
  const text = renderPage("models");
  expect(text).toContain("N/A");
  expect(text).toContain("Anthropic - Claude Haiku 4.5");
});

test("errors groups failures by their recorded reason", () => {
  const text = renderPage("errors");
  expect(text).toContain("upstream 529");
});

test("errors folds rows sharing a reason into one group bar", () => {
  const base = report().recent[1];
  const rows = [
    { ...base, id: "e1", t: Date.parse("2026-09-30T11:00:00Z") },
    { ...base, id: "e2", t: Date.parse("2026-09-30T12:00:00Z") },
  ];
  renderPage("errors", { recent: rows });
  // The group bar is rendered before the recent-failures list, so the first match is the bar.
  const bar = screen.getAllByText("upstream 529")[0].closest("li");
  expect(bar?.textContent).toContain("2");
});

test("requests shows the TTFT strip and column, N/A when the host recorded none", () => {
  const text = renderPage("requests");
  expect(text).toContain("TTFT");
  // The fixture carries no ttft, so the mean is absent rather than zero.
  expect(text).toContain("0 of 2 recorded");
});

test("requests reports a measured TTFT when the host recorded one", () => {
  const rows = report().recent.map((r) => ({ ...r, tf: 420 }));
  const text = renderPage("requests", { recent: rows });
  expect(text).toContain("420ms");
  expect(text).toContain("2 of 2 recorded");
});

test("overview strip reports average elapsed and TTFT from the range", () => {
  const rows = report().recent.map((r, i) => ({ ...r, tf: i === 0 ? 300 : 500 }));
  const text = renderPage("overview", { recent: rows });
  expect(text).toContain("Avg elapsed");
  expect(text).toContain("1.1s");
  expect(text).toContain("400ms");
  expect(text).toContain("2 recorded");
});

test("overview says N/A when no row carried a time to first token", () => {
  const text = renderPage("overview");
  expect(text).toContain("Avg elapsed");
  expect(text).toContain("0 recorded");
});

test("providers reports per-provider totals and keeps the unrecordable windows honest", () => {
  const text = renderPage("providers");
  // The strip reads the range's tables: one provider, two runs, one of them failed.
  expect(text).toContain("most tokens: anthropic");
  expect(text).toContain("1 failed");
  expect(text).toContain("1 succeeded");
  expect(text).toContain("1/1 models priced");
  // Every column the table promises is rendered, sortable headers included.
  for (const header of ["Provider", "Requests", "Error rate", "Models", "Tokens", "Share", "Cost", "Tokens/s"]) {
    expect(text, `${header} column missing`).toContain(header);
  }
  // Tersio stores no subscription window, so those two sections hold a note rather than a table.
  expect(text).toContain("Subscription windows");
  expect(text).toContain("no subscription, quota, reset, or rate-limit windows");
  expect(text).toContain("Window utilization");
  expect(text).toContain("no utilization to show");
});

test("providers shows N/A for a provider whose models carry no price", () => {
  const text = renderPage("providers", {
    modelRates: {
      "Anthropic - Claude Haiku 4.5": {
        provider: "space-bunny",
        known: false,
        input: 1,
        output: 5,
        cacheRead: 0.1,
        cacheWrite: 1.25,
      },
    },
  });
  expect(text).toContain("space-bunny");
  expect(text).toContain("N/A");
});

test("the overview chart switches its series with the mode control", () => {
  renderPage("overview");
  expect(screen.getByText("Tokens per day")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Requests" }));
  expect(screen.getByText("Requests per day")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Cost" }));
  expect(screen.getByText("Cost per day")).toBeTruthy();
});

test("a model detail panel mounts no charting-library instance", () => {
  // A detail panel used to render a full recharts chart, so expanding a row froze the page on a slow
  // machine: one chart mount per open row, all synchronous. The panel must draw its tiny day bars
  // with plain elements, which one assert guards for every row that ever opens.
  const { container } = render(
    <PageBody
      page="models"
      data={report()}
      cutoff={null}
      since={null}
      range="all"
      money={(v) => `$${v.toFixed(2)}`}
      fx={{ cur: "USD", rates: { USD: 1 }, live: false }}
      onCurrency={() => undefined}
    />,
  );
  const expanders = container.querySelectorAll('button[aria-label^="Expand"]');
  expect(expanders.length).toBeGreaterThan(0);
  for (const button of expanders) fireEvent.click(button);
  const detailCharts = [...container.querySelectorAll("tbody [class*='recharts']")];
  expect(detailCharts.length, "a detail panel rendered a chart instance").toBe(0);
  // The day bars it draws instead are plain spans, one per day of the range.
  expect(container.querySelectorAll("tbody span[aria-hidden='true']").length).toBeGreaterThan(0);
});

test("a provider detail panel mounts no charting-library instance", () => {
  const { container } = render(
    <PageBody
      page="providers"
      data={report()}
      cutoff={null}
      since={null}
      range="all"
      money={(v) => `$${v.toFixed(2)}`}
      fx={{ cur: "USD", rates: { USD: 1 }, live: false }}
      onCurrency={() => undefined}
    />,
  );
  const expanders = container.querySelectorAll('button[aria-label^="Expand"]');
  expect(expanders.length).toBeGreaterThan(0);
  for (const button of expanders) fireEvent.click(button);
  const detailCharts = [...container.querySelectorAll("tbody [class*='recharts']")];
  expect(detailCharts.length, "a detail panel rendered a chart instance").toBe(0);
});

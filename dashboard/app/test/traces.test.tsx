// @vitest-environment happy-dom
// The traces page reads the dashboard API only. Every answer here is a stubbed fetch, so these
// tests pin both the request the page makes and what it draws from the response.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";

import { PageBody } from "../src/pages";
import type { PageProps } from "../src/pages/types";
import { report } from "./fixtures";
import type { SessionListEntry, SessionTrace, TranscriptEntry } from "../src/lib/data";

const BASE = Date.parse("2026-10-08T10:00:00Z");
const SESSION_FILE = "/sessions/2026-10-08-a.jsonl";

const SESSIONS: SessionListEntry[] = [
  {
    file: SESSION_FILE,
    folder: "/Users/x/proj",
    title: "Fix the thing",
    startedAt: BASE,
    endedAt: BASE + 8000,
    requests: 2,
    toolCalls: 1,
    subagents: 1,
    totalTokens: 1234,
    costTotal: 0.05,
    unpricedRequests: 0,
    models: ["main-model"],
  },
  {
    file: "/sessions/2026-10-07-b.jsonl",
    folder: "/Users/x/other",
    title: "",
    startedAt: BASE - 86_400_000,
    endedAt: BASE - 86_400_000 + 1000,
    requests: 0,
    toolCalls: 0,
    subagents: 0,
    totalTokens: 0,
    costTotal: 0,
    unpricedRequests: 0,
    models: [],
  },
];

const TRACE: SessionTrace = {
  file: SESSION_FILE,
  title: "Fix the thing",
  cwd: "/Users/x/proj",
  startedAt: BASE,
  endedAt: BASE + 8000,
  tracks: [
    {
      id: "main",
      parentId: null,
      label: "main",
      agent: "omp",
      file: SESSION_FILE,
      model: "main-model",
      spans: [
        { id: "main:t1", kind: "turn", start: BASE, end: BASE + 8000, label: "Do the thing", entryId: "t1" },
        {
          id: "main:a1",
          kind: "model",
          start: BASE + 1000,
          end: BASE + 4000,
          label: "main-model",
          entryId: "a1",
          model: "main-model",
          ttft: 400,
          tokens: 165,
          stop: "toolUse",
        },
        { id: "main:tool:c1", kind: "tool", start: BASE + 4500, end: BASE + 6000, label: "bash", entryId: "r1", detail: '{\n  "command": "ls"\n}' },
        { id: "main:sub:Scout", kind: "subagent", start: BASE + 2000, end: BASE + 3500, label: "scout", childTrackId: "Scout" },
        { id: "main:bg:c2", kind: "background", start: BASE + 5000, end: BASE + 5200, label: "task job", unterminated: true },
      ],
      markers: [{ time: BASE + 500, kind: "model_change", label: "main-model" }],
    },
    {
      id: "Scout",
      parentId: "main",
      label: "Scout",
      agent: "scout",
      file: "/sessions/2026-10-08-a/Scout.jsonl",
      model: "child-model",
      spans: [{ id: "Scout:a1", kind: "model", start: BASE + 2500, end: BASE + 3400, label: "child-model", entryId: "ca1" }],
      markers: [],
    },
  ],
  summary: {
    wallMs: 8000,
    modelMs: 3900,
    toolMs: 1500,
    idleMs: 2600,
    turns: 1,
    requests: 2,
    toolCalls: 1,
    subagents: 1,
    totalTokens: 200,
    costTotal: 0.05,
    unpricedRequests: 1,
    models: ["child-model", "main-model"],
    toolStats: [{ tool: "bash", calls: 1, errors: 0, totalMs: 1500, maxMs: 1500 }],
  },
};

const ENTRY: TranscriptEntry = {
  id: "a1",
  role: "assistant",
  timestamp: new Date(BASE + 1000).toISOString(),
  content: [{ type: "text", text: "hello there" }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let calls: string[] = [];

function stubFetch(handler: (url: string) => Response): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  });
}

function renderTraces(props: Partial<PageProps> = {}): RenderResult {
  return render(
    <PageBody
      page="traces"
      data={report({ modelLabels: { "main-model": "Main Model", "child-model": "Child Model" } })}
      cutoff={null}
      since={null}
      range="all"
      money={(v) => `$${v.toFixed(2)}`}
      fx={{ cur: "USD", rates: { USD: 1 }, live: false }}
      onCurrency={() => undefined}
      {...props}
    />,
  );
}

/** The trace view's own routes, with the session list as the fallback. */
function traceStub(entry: (url: string) => Response = () => json({ entry: ENTRY })): void {
  stubFetch((url) => {
    if (url.startsWith("session/entry")) return entry(url);
    if (url.startsWith("session/trace")) return json(TRACE);
    return json({ sessions: SESSIONS });
  });
}

beforeEach(() => {
  // Every test stubs its own answer; this keeps an unstubbed call from reaching the network.
  stubFetch(() => json({ sessions: [] }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the sessions view lists the server's sessions, with a folder fallback for an untitled one", async () => {
  stubFetch(() => json({ sessions: SESSIONS }));
  renderTraces();

  expect(await screen.findByText("Fix the thing")).toBeTruthy();
  // An empty title falls back to the folder's basename rather than rendering a blank cell.
  expect(screen.getByText("other")).toBeTruthy();
  expect(screen.getByText("1,234")).toBeTruthy();
  expect(calls).toEqual(["sessions"]);
});

test("typing in the search box asks the server for matches after the debounce", async () => {
  stubFetch((url) => json({ sessions: url.includes("q=scout") ? SESSIONS.slice(0, 1) : SESSIONS }));
  renderTraces();
  await screen.findByText("Fix the thing");

  fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "scout" } });
  await waitFor(() => expect(calls.some((url) => url.includes("q=scout"))).toBe(true));
  // The server's filtered answer replaces the list, so the folder-only row is gone.
  await waitFor(() => expect(screen.queryByText("other")).toBe(null));
});

test("no sessions at all says so instead of showing an empty table", async () => {
  renderTraces();
  expect(await screen.findByText("No sessions recorded")).toBeTruthy();
});

test("the trace view draws the summary strip and the counts", async () => {
  traceStub();
  renderTraces({ session: SESSION_FILE });

  expect(await screen.findByText("Timeline")).toBeTruthy();
  expect(screen.getByText("Wall")).toBeTruthy();
  expect(screen.getByText("8.0s")).toBeTruthy();
  expect(screen.getByText("3.9s")).toBeTruthy();
  // Tool time appears three times: the strip total, and the bash row's total and max.
  expect(screen.getAllByText("1.5s")).toHaveLength(3);
  expect(screen.getByText("2.6s")).toBeTruthy();
  expect(screen.getByText("Turns")).toBeTruthy();
  expect(screen.getByText("no public price for 1 request")).toBeTruthy();
  // The tool table reads the summary's own stats.
  expect(screen.getByText("bash")).toBeTruthy();
  expect(calls.some((url) => url.startsWith("session/trace?file="))).toBe(true);
});

test("the waterfall draws one lane per track and a bar per span", async () => {
  traceStub();
  const { container } = renderTraces({ session: SESSION_FILE });
  await screen.findByText("Timeline");

  expect(container.querySelectorAll("[data-track]")).toHaveLength(2);
  expect(container.querySelector('[data-track="Scout"]')).toBeTruthy();
  // A bar exists for a model span, a tool span, a subagent span, and a malformed background span.
  for (const id of ["main:a1", "main:tool:c1", "main:sub:Scout", "main:bg:c2", "Scout:a1"]) {
    expect(container.querySelector(`[data-span="${id}"]`), id).toBeTruthy();
  }
  // The background span has no result yet, so it is drawn dashed rather than as a finished bar.
  expect(container.querySelector('[data-span="main:bg:c2"] rect')?.getAttribute("stroke-dasharray")).toBe("3 2");
  // A model change is a marker, labelled in the chart.
  expect(screen.getByText("main-model")).toBeTruthy();
});

test("selecting a span opens the drawer with the raw transcript row", async () => {
  traceStub();
  const { container } = renderTraces({ session: SESSION_FILE });
  await screen.findByText("Timeline");

  fireEvent.click(container.querySelector('[data-span="main:a1"]') as Element);

  // The row's role, its content, and the span's own recorded fields.
  expect(await screen.findByText("assistant")).toBeTruthy();
  expect(screen.getByText(/hello there/)).toBeTruthy();
  expect(screen.getByText("165")).toBeTruthy();
  expect(calls.some((url) => url.startsWith("session/entry?file=") && url.includes("id=a1"))).toBe(true);
});

test("a missing transcript row shows the server's own error", async () => {
  traceStub(() => json({ error: "no row with that id" }, 404));
  const { container } = renderTraces({ session: SESSION_FILE });
  await screen.findByText("Timeline");

  fireEvent.click(container.querySelector('[data-span="main:a1"]') as Element);
  expect(await screen.findByText("no row with that id")).toBeTruthy();
});

test("a failed trace read shows the error and offers a retry", async () => {
  stubFetch((url) => (url.startsWith("session/trace") ? json({ error: "unreadable transcript" }, 500) : json({ sessions: SESSIONS })));
  renderTraces({ session: "/sessions/gone.jsonl" });

  expect(await screen.findByText("unreadable transcript")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Read it again" })).toBeTruthy();
});

test("a session whose transcript has no timed row says so instead of drawing an empty chart", async () => {
  stubFetch((url) =>
    url.startsWith("session/trace")
      ? json({
          ...TRACE,
          tracks: [{ ...TRACE.tracks[0], spans: [], markers: [] }],
          summary: { ...TRACE.summary, wallMs: 7, modelMs: 0, toolMs: 0, idleMs: 7, turns: 0, requests: 0, toolCalls: 0, subagents: 0, totalTokens: 0, costTotal: 0, unpricedRequests: 0, models: [], toolStats: [] },
        })
      : json({ sessions: SESSIONS }),
  );
  const { container } = renderTraces({ session: "/sessions/2026-10-08-empty.jsonl" });

  expect(await screen.findByText(/recorded no span/)).toBeTruthy();
  expect(screen.getByText("This session recorded no tool call.")).toBeTruthy();
  expect(container.querySelector("[data-span]")).toBe(null);
});

test("a subagent span hands off to its own track", async () => {
  traceStub();
  const { container } = renderTraces({ session: SESSION_FILE });
  await screen.findByText("Timeline");

  fireEvent.click(container.querySelector('[data-span="main:sub:Scout"]') as Element);
  // No entryId: the span's own fields, not a transcript row, are what it can show.
  fireEvent.click(await screen.findByRole("button", { name: "Open the Scout track" }));

  await waitFor(() => expect(screen.queryByRole("button", { name: "Open the Scout track" })).toBe(null));
  expect(container.querySelector('[data-track="Scout"] rect')?.getAttribute("fill")).toBe("var(--accent-soft)");
});

test("the back control clears the session param", async () => {
  traceStub();
  const onSession = vi.fn();
  renderTraces({ session: SESSION_FILE, onSession });
  await screen.findByText("Timeline");

  fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
  expect(onSession).toHaveBeenCalledWith(null);
});

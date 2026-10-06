// @vitest-environment happy-dom
// The dashboard's rendered surface: selecting a request row opens its detail.
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Recent } from "../src/components/recent";
import type { RecentRequestRow, UsageReport } from "../src/lib/data";

const ROW: RecentRequestRow = {
  m: "opencode/github-copilot/claude-haiku-4.5",
  i: 2575,
  o: 140,
  t: Date.parse("2026-09-01T10:00:00Z"),
  d: 3238,
  h: "opencode",
  cr: 128,
  est: 0,
  st: "completed",
  id: "msg_be5f66639001FzeXG2XfsYp946",
};

const money = (v: number): string => `$${v.toFixed(2)}`;

function report(recent: RecentRequestRow[]): UsageReport {
  return { recent } as UsageReport;
}

afterEach(cleanup);

test("the recent table renders a row's folded model label and tokens", () => {
  render(<Recent data={report([ROW])} money={money} />);
  expect(screen.getByText("Anthropic - Claude - Haiku-4.5")).toBeTruthy();
  expect(screen.getByText("2,575")).toBeTruthy();
  expect(screen.getByText("140")).toBeTruthy();
  expect(screen.getByText("1 requests")).toBeTruthy();
});

test("selecting a row opens its detail, and closing it removes the detail", async () => {
  const { container } = render(<Recent data={report([ROW])} money={money} />);
  const row = container.querySelector("#recentTable tbody tr");
  expect(row, "the table rendered a body row").toBeTruthy();
  fireEvent.click(row as Element);

  // 2575 + 140 + 128 cache read; the table shows the parts, only the drawer sums them.
  expect(await screen.findByText("2,843")).toBeTruthy();
  expect(screen.getByText("msg_be5f66639001FzeXG2XfsYp946")).toBeTruthy();
  expect(screen.getByText("opencode/github-copilot/claude-haiku-4.5")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy JSON" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await expect.poll(() => screen.queryByText("msg_be5f66639001FzeXG2XfsYp946")).toBe(null);
});

test("an empty report shows the empty state instead of a table", () => {
  const { container } = render(<Recent data={report([])} money={money} />);
  expect(screen.getByText("No requests yet")).toBeTruthy();
  expect(container.querySelector("#recentTable")).toBe(null);
});

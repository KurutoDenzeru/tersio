import { expect, test } from "vitest";

import { requestDetailJson } from "../../dashboard/app/src/components/request-drawer.tsx";
import type { RecentRequestRow } from "../../dashboard/app/src/lib/data.ts";

const ROW: RecentRequestRow = {
  m: "opencode/github-copilot/claude-haiku-4.5",
  i: 2575,
  o: 140,
  t: 1790849074029,
  d: 3238,
  h: "opencode",
  cr: 128,
  est: 0,
  st: "completed",
  id: "msg_be5f66639001FzeXG2XfsYp946",
};

test("request detail carries the recorded fields and nothing invented", () => {
  const detail = requestDetailJson(ROW);
  expect(detail).toMatchObject({
    id: "msg_be5f66639001FzeXG2XfsYp946",
    model: "Anthropic - Claude - Haiku-4.5",
    modelKey: "opencode/github-copilot/claude-haiku-4.5",
    vendor: "Anthropic",
    agent: "opencode",
    status: "completed",
    inputTokens: 2575,
    outputTokens: 140,
    cacheReadTokens: 128,
    cacheWriteTokens: 0,
    elapsedMs: 3238,
  });
  expect(detail).not.toHaveProperty("requestID");
  expect(detail).not.toHaveProperty("headers");
  expect(typeof detail.time).toBe("string");
});

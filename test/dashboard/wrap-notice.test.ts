// The wrap-switch announcements: plain sentences, one per flip kind.
import { expect, test } from "vitest";

import { wrapNotice } from "../../dashboard/app/src/components/agents/how-to-node-ui.tsx";

const DURABLE = { label: "Claude Code", durable: true };

test("a durable flip announces the built-in integration, not the command", () => {
  expect(wrapNotice(DURABLE, "claude", true)).toEqual({ title: "Claude Code has headroom built in now.", desc: "It stays on across restarts." });
  expect(wrapNotice(DURABLE, "claude", false)).toEqual({ title: "Claude Code no longer has headroom built in.", desc: "Its integration is undone." });
});

test("a plain wrap flip speaks of the launch, and an unknown target falls back to its id", () => {
  expect(wrapNotice({ label: "Aider", durable: false }, "aider", true)).toEqual({ title: "Aider starts through headroom now.", desc: "Its next session picks it up." });
  expect(wrapNotice(undefined, "goose", false)).toEqual({ title: "goose no longer starts through headroom.", desc: "It launches the way it did before." });
});

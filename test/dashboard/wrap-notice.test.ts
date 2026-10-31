// The wrap-switch announcements: plain sentences, one per flip kind.
import { expect, test } from "vitest";

import { wrapNotice } from "../../dashboard/app/src/components/agents/how-to-node-ui.tsx";

const DURABLE = { label: "Claude Code", kind: "wrap", durable: true };
const PROXY = { label: "Command Code", kind: "proxy", durable: false };

test("a durable flip announces the built-in integration, not the command", () => {
  expect(wrapNotice(DURABLE, "claude", true)).toEqual({ title: "Claude Code has headroom built in now.", desc: "It stays on across restarts." });
  expect(wrapNotice(DURABLE, "claude", false)).toEqual({ title: "Claude Code no longer has headroom built in.", desc: "Its integration is undone." });
});

test("a proxy flip says where the traffic goes and what the user must do", () => {
  expect(wrapNotice(PROXY, "commandcode", true)).toEqual({ title: "Command Code routes through the shared proxy now.", desc: "Copy an address below into its settings." });
  // pi and pig get their provider config rewritten, so the copy step does not apply.
  expect(wrapNotice({ ...PROXY, label: "Pi" }, "pi", true)).toEqual({ title: "Pi routes through the shared proxy now.", desc: "Its provider settings now point at the proxy." });
  expect(wrapNotice(PROXY, "commandcode", false)).toEqual({ title: "Command Code no longer routes through the shared proxy.", desc: "Remove the proxy address from its settings if you set one." });
});

test("a plain wrap flip speaks of the launch, and an unknown target falls back to its id", () => {
  expect(wrapNotice({ label: "Aider", kind: "wrap", durable: false }, "aider", true)).toEqual({ title: "Aider starts through headroom now.", desc: "The shared proxy rides along." });
  expect(wrapNotice(undefined, "goose", false)).toEqual({ title: "goose no longer starts through headroom.", desc: "It launches the way it did before." });
});

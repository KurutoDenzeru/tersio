import { expect, test } from "vitest";

import { displayModel, vendorOf } from "../../dashboard/app/src/lib/format.ts";

test("provider-prefixed keys fold into vendor-first labels", () => {
  expect(displayModel("space-bunny")).toBe("Stealth - Space-Bunny");
  expect(displayModel("opencode/Openai/gpt-5.2-Codex")).toBe("OpenAI - GPT-5.2-Codex");
  expect(displayModel("opencode/Github-Copilot/claude-Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
  expect(displayModel("opencode/Google/claude-Opus-4-5-Thinking")).toBe("Anthropic - Claude - Opus-4-5-Thinking");
  expect(displayModel("meta/Muse-Spark-1.3-Contributor")).toBe("Meta - Muse-Spark-1.3-Contributor");
  expect(displayModel("Gpt-6-Luna")).toBe("OpenAI - GPT-6-Luna");
  expect(displayModel("Swe-1-6-Slow")).toBe("Cognition - Swe-1-6-Slow");
});

test("labels skip a redundant vendor prefix and keep unknowns readable", () => {
  expect(displayModel("Qwen3.8-Flash")).toBe("Qwen3.8-Flash");
  expect(displayModel("opencode/Github-Copilot/oswe-Vscode-Prime")).toBe("Github-Copilot - Oswe-Vscode-Prime");
  expect(displayModel("llama-3.3-70b")).toBe("Meta - Llama-3.3-70B");
});

test("vendor mapping covers the open-weight families", () => {
  expect(vendorOf("llama-3.3-70b").name).toBe("Meta");
  expect(vendorOf("Qwen3.8-Flash").name).toBe("Qwen");
  expect(vendorOf("opencode/Github-Copilot/claude-Haiku-4.5").name).toBe("Anthropic");
});

import { expect, test } from "vitest";

import { displayModel, vendorOf } from "../../dashboard/app/src/lib/format.ts";

test("provider-prefixed keys fold into vendor-first labels", () => {
  expect(displayModel("space-bunny")).toBe("Stealth - Space-Bunny");
  expect(displayModel("opencode/Openai/gpt-5.2-Codex")).toBe("OpenAI - GPT-5.2-Codex");
  expect(displayModel("opencode/Github-Copilot/claude-Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
  expect(displayModel("opencode/Google/claude-Opus-4-5-Thinking")).toBe("Anthropic - Claude - Opus-4-5-Thinking");
  expect(displayModel("meta/Muse-Spark-1.3-Contributor")).toBe("Meta - Muse-Spark-1.3-Contributor");
  expect(displayModel("Gpt-6-Luna")).toBe("OpenAI - GPT-6-Luna");
  expect(displayModel("Swe-1-6-Slow")).toBe("Cognition - SWE-1-6-Slow");
  expect(displayModel("opencode/nvidia/minimaxai/minimax-m2.7")).toBe("Minimax-M2.7");
  expect(displayModel("opencode/nvidia/google/gemma-4-31b-it")).toBe("Google - Gemma-4-31B-IT");
  expect(displayModel("opencode/kilo/stealth/space-bunny-alpha")).toBe("Stealth - Space-Bunny");
});

test("folded labels pass through untouched", () => {
  expect(displayModel("Stealth - Space-Bunny")).toBe("Stealth - Space-Bunny");
  expect(displayModel("OpenAI - GPT-5.2-Codex")).toBe("OpenAI - GPT-5.2-Codex");
  expect(displayModel("Anthropic - Claude - Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
  expect(displayModel("Cognition - SWE-1-6-Slow")).toBe("Cognition - SWE-1-6-Slow");
});

test("labels skip a redundant vendor prefix and keep unknowns readable", () => {
  expect(displayModel("Deepseek-V4.1-Flash")).toBe("Deepseek-V4.1-Flash");
  expect(displayModel("opencode/Github-Copilot/oswe-Vscode-Prime")).toBe("Github-Copilot - Oswe-Vscode-Prime");
  expect(displayModel("llama-3.3-70b")).toBe("Meta - Llama-3.3-70B");
});

test("vendor mapping covers Alibaba, InclusionAI, xAI, and open weights", () => {
  expect(vendorOf("llama-3.3-70b").name).toBe("Meta");
  expect(vendorOf("Qwen3.8-Flash").name).toBe("Alibaba");
  expect(displayModel("Qwen3.8-Flash")).toBe("Alibaba - Qwen3.8-Flash");
  expect(vendorOf("opencode/inclusionai/ling-3.1-flash").name).toBe("InclusionAI");
  expect(displayModel("opencode/inclusionai/ling-3.1-flash")).toBe("InclusionAI - Ling-3.1-Flash");
  expect(vendorOf("opencode/Github-Copilot/grok-code-fast-1").name).toBe("xAI");
  expect(displayModel("opencode/Github-Copilot/grok-code-fast-1")).toBe("xAI - Grok-Code-Fast-1");
  expect(vendorOf("opencode/Github-Copilot/claude-Haiku-4.5").name).toBe("Anthropic");
});

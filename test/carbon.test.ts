import test from "node:test";
import assert from "node:assert/strict";

import {
  SERVING_CONCURRENCY,
  carbonParamsFor,
  co2GramsFor,
  footprintFor,
} from "../extensions/shared/carbon.js";

test("unknown models fall back to the gpt-4o default", () => {
  const { paramSource: _a, ...fallback } = footprintFor("zzz-unknown-9", 1000);
  const { paramSource: _b, ...baseline } = footprintFor("gpt-4o", 1000);
  assert.deepEqual(fallback, baseline);
  assert.equal(carbonParamsFor("zzz-unknown-9").source, "default");
});

test("registry models resolve with registry params", () => {
  assert.equal(carbonParamsFor("claude-opus-4-99").source, "registry");
  assert.equal(carbonParamsFor("claude-opus-4-99").provider, "anthropic");
  assert.equal(carbonParamsFor("claude-sonnet-5").source, "registry");
  assert.equal(carbonParamsFor("gemini-2.5-flash").provider, "google");
});

test("larger models cost more per output token", () => {
  const opus = co2GramsFor("claude-opus-4", 1000);
  const sonnet = co2GramsFor("claude-sonnet-5", 1000);
  const haiku = co2GramsFor("claude-haiku-4", 1000);
  assert.ok(opus > sonnet && sonnet > haiku && haiku > 0, `${opus} > ${sonnet} > ${haiku} > 0`);
});

test("served figure is the single-stream ceiling over concurrency", () => {
  const f = footprintFor("claude-sonnet-5", 10000);
  assert.equal(f.concurrency, SERVING_CONCURRENCY);
  assert.ok(Math.abs(f.gco2 * SERVING_CONCURRENCY - f.gco2Ceiling) < 1e-9);
  assert.ok(f.energyWh > 0);
});

test("zero output tokens yields zero footprint", () => {
  assert.deepEqual(footprintFor("gpt-4o", 0), {
    energyWh: 0,
    gco2: 0,
    gco2Ceiling: 0,
    concurrency: SERVING_CONCURRENCY,
    provider: "openai",
    paramSource: "registry",
  });
});

test("footprint is deterministic", () => {
  assert.deepEqual(footprintFor("deepseek-v4", 7777), footprintFor("deepseek-v4", 7777));
});

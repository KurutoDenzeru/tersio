import { expect, test } from "vitest";

import {
  SERVING_CONCURRENCY,
  carbonParamsFor,
  co2GramsFor,
  footprintFor,
} from "../../extensions/shared/carbon.ts";

test("unknown models fall back to the gpt-4o default", () => {
  const { paramSource: _a, ...fallback } = footprintFor("zzz-unknown-9", 1000);
  const { paramSource: _b, ...baseline } = footprintFor("gpt-4o", 1000);
  expect(fallback).toEqual(baseline);
  expect(carbonParamsFor("zzz-unknown-9").source).toBe("default");
});

test("registry models resolve with registry params", () => {
  expect(carbonParamsFor("claude-opus-4-99").source).toBe("registry");
  expect(carbonParamsFor("claude-opus-4-99").provider).toBe("anthropic");
  expect(carbonParamsFor("claude-sonnet-5").source).toBe("registry");
  expect(carbonParamsFor("gemini-2.5-flash").provider).toBe("google");
});

test("larger models cost more per output token", () => {
  const opus = co2GramsFor("claude-opus-4", 1000);
  const sonnet = co2GramsFor("claude-sonnet-5", 1000);
  const haiku = co2GramsFor("claude-haiku-4", 1000);
  expect(opus > sonnet && sonnet > haiku && haiku > 0, `${opus} > ${sonnet} > ${haiku} > 0`).toBeTruthy();
});

test("served figure is the single-stream ceiling over concurrency", () => {
  const f = footprintFor("claude-sonnet-5", 10000);
  expect(f.concurrency).toBe(SERVING_CONCURRENCY);
  expect(Math.abs(f.gco2 * SERVING_CONCURRENCY - f.gco2Ceiling) < 1e-9).toBeTruthy();
  expect(f.energyWh > 0).toBeTruthy();
});

test("zero output tokens yields zero footprint", () => {
  expect(footprintFor("gpt-4o", 0)).toEqual({
    energyWh: 0,
    gco2: 0,
    gco2Ceiling: 0,
    concurrency: SERVING_CONCURRENCY,
    provider: "openai",
    paramSource: "registry",
  });
});

test("footprint is deterministic", () => {
  expect(footprintFor("deepseek-v4", 7777)).toEqual(footprintFor("deepseek-v4", 7777));
});

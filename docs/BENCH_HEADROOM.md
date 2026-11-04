# Tersio benchmark: Headroom

Protocol: [BENCHMARK.md](./BENCHMARK.md), section 9.

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `commandcode/deepseek/deepseek-v4.1-flash` (DeepSeek V4.1 Flash · Command Code), thinking effort `max`
- Headroom: 0.42.0
- Proxy mode: token
- Proxy upstream: `http://127.0.0.1:3425/v1` (the local gateway the agent uses)
- JSONL path: `/tmp/headroom-bench.jsonl`, `/tmp/headroom-sweep.jsonl`, `/tmp/headroom-sentinel.jsonl`
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: one payload per row, 2026-11-03

Headroom 0.42.0 writes `request_messages` but leaves `compressed_messages` null, even with `--log-messages`, so no row can show the sentinel under the guide's JSONL query. The sentinel is checked in the `/v1/compress` response body instead.

**Verdict: compression is real and safe — 94.9% of a fixed log payload removed through `/v1/compress` with the sentinel intact, and 17.5% on grep-shaped tool output through the proxy. It fires on shapes the router recognises; plain log and JSON tool_results pass through unchanged in 0.42.0.**

## Compression

| Payload | Tokens before | Tokens after | Saved | Saved % | Transforms | Sentinel |
|---|---:|---:|---:|---:|---|---|
| Log | 7397 | 377 | 7020 | 94.9% | `router:log:0.05` | pass |
| JSON | 17157 | 17157 | 0 | 0% | `router:excluded:tool` | n/a |

The log row went through `/v1/compress` with request id `hr_1793705048_000001`. The JSON row is 400 objects sent as a tool_result through the proxy, request id `hr_1793705157_000002`. The two rows take different paths and are not compared.

## Agent turn

| Request ID | Model | Input original | Input optimized | Saved | Saved % | Transforms | Sentinel |
|---|---|---:|---:|---:|---:|---|---|
| `hr_1793705091_000001` | `deepseek-v4.1-flash` | 10912 | 10912 | 0 | 0% | `router:noop` | not recorded |
| `hr_1793705186_000001` | `deepseek-v4.1-flash` | 13670 | 11282 | 2388 | 17.5% | `router:excluded:lossless_search` | not recorded |

The first row sent 200 log lines as a tool_result, and the router compressed nothing. The second sent 600 grep-style match lines carrying a `FATAL checkout failed order=8841` sentinel, and the same line is present in `request_messages`.

## Findings

- A fixed log payload compresses to 5% of its size through `/v1/compress`, and the fatal line survives.
- In the proxy path, compression fires on tool_result shapes the router recognises as search output.
- A plain log block and a JSON catalog tool_result both pass through unchanged, with `router:noop` and `router:excluded:tool`.
- The agent's live endpoint is `http://127.0.0.1:8787/v1`, and the proxy forwards to the local gateway on `3425`, so agent traffic reaches Headroom before the gateway.

## Gates

- `tokens_saved > 0`.
- `transforms_applied` is not empty.
- Every required sentinel line or JSON key survives in `compressed_messages`.
- The active model endpoint points at the proxy upstream.

Two gates hold on the log row. The sentinel gate is checked in the response body, not in the JSONL, for the reason stated above. The agent-turn rows record no saving on the plain log shape, so they publish none.

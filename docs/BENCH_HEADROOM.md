# Tersio benchmark: Headroom

Protocol: [BENCHMARK.md](./BENCHMARK.md), section 9.

- Agent: <name and version>
- Model: <provider/model>
- Headroom: <version>
- Proxy mode: token
- Proxy upstream: <URL>
- JSONL path: </tmp/headroom-bench.jsonl>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <N>, <date>

## Compression

| Payload | Tokens before | Tokens after | Saved | Saved % | Transforms | Sentinel |
|---|---:|---:|---:|---:|---|---|
| Log | ___ | ___ | ___ | ___% | ___ | pass/fail |
| JSON | ___ | ___ | ___ | ___% | ___ | pass/fail |

## Agent turn

| Request ID | Model | Input original | Input optimized | Saved | Saved % | Transforms | Sentinel |
|---|---|---|---:|---:|---:|---:|---|---|
| ___ | ___ | ___ | ___ | ___ | ___% | ___ | pass/fail |

## Findings

- <findings>

## Gates

- `tokens_saved > 0`.
- `transforms_applied` is not empty.
- Every required sentinel line or JSON key survives in `compressed_messages`.
- The active model endpoint points at the proxy upstream.

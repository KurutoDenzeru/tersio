# Plan: port the omp-stats dashboard into the Tersio dashboard

> Superseded in part: the dashboard ships as one hash-routed page per view (`#/providers?range=7d`), matching the reference layout page for page, with Settings and Share in the rail footer and the theme button in the topbar. This plan's single-scroll layout and its section list were replaced by that routing. `docs/ARCHITECTURE.md`, `README.md`, and `CHANGELOG.md` describe what shipped.

## Goal

Port every `@oh-my-pi/omp-stats` page into the Tersio dashboard: Overview, Models, Providers, Costs, Requests, Errors, Traces, Tools, Frustration, Projects, Gain. Keep one server, one snapshot, one visual language.

## Skill

Use the `design-taste-frontend` skill for every UI change in this work. Invoke it before you touch a component.

Scope caveat, from the skill's own Section 13: it targets landing pages, portfolios, and redesigns. Dashboards and dense product UI are out of scope. Apply the transferable rules only, and keep the existing shadcn + Tailwind + recharts system.

Design read: a local observability dashboard for one technical operator, dense and dark-first, terminal-adjacent. Dials: `DESIGN_VARIANCE: 3` (grid discipline, no asymmetric art), `MOTION_INTENSITY: 2` (state changes only), `VISUAL_DENSITY: 8` (cockpit).

Rules that transfer, checked at review:

| Rule | Application here |
|---|---|
| Icons from one allowed family | `lucide-react` is already a dependency and is addressed by name through `components/icon.tsx`. One family, one stroke width |
| No hand-rolled icon paths | Brand marks come from official assets. See Brand marks |
| No em-dash in any string | Hyphen only, in copy, tooltips, axis labels, and empty states |
| One accent, one radius scale, one theme | Locked in the `index.css` tokens. No section inverts |
| Contrast in both themes | Every button, badge, tile, and mark |
| Loading, empty, and error states | Per page, shaped like the final layout |
| Reduced motion | Anything beyond a state transition |
| No decoration tells | No section-number eyebrows, no version stamps, no scroll cues, no locale strips, no fake-precision numbers, no invented sample data |

## shadcn/ui

Use shadcn/ui for every control. Add with the CLI, never hand-write a component shadcn ships.

Installed base: `shadcn@4.21`, `components.json` with style `base-nova`, `baseColor: neutral`, `iconLibrary: lucide`, `cssVariables: true`, `rsc: false` (a Vite SPA, so no Server Components). 58 components sit in `dashboard/app/src/components/ui`.

Check this table before you write any control.

| Plan primitive | shadcn source | State |
|---|---|---|
| `Table` | `ui/table` | present |
| `Card` | `ui/card` | present |
| `Segmented` | `ui/toggle-group` | present |
| `Legend` | `ui/chart` `ChartLegend` and `ChartLegendContent` | present |
| `TimeChart`, `Chart`, `Sparkline` | `ui/chart` `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig` over `recharts` | present |
| `StatGrid`, `Stat` | `ui/card` and `ui/item` | present |
| `MeterCell` | `ui/progress` and `ui/tooltip` | present |
| `SearchInput` | `ui/command` and `ui/input` | present |
| Loading skeleton | `ui/skeleton` | present |
| Empty state | `ui/empty` and `EmptyState` in `components/common.tsx` | present |
| Request drawer | `ui/sheet` | present, used by `request-drawer.tsx` |
| Range picker | `ui/toggle-group` | present |
| Hover tips | `ui/tooltip`, `ui/hover-card`, `HoverTip` in `components/common.tsx` | present |
| Long tables | `ui/scroll-area` | present |
| Status chips | `ui/badge` | present |
| Toasts | `ui/toast` and `components/toaster.tsx` | present, `sonner` is not installed |
| `ShareBar` | `ShareBar` in `components/common.tsx` | present, extend it, do not add a second |

Add a component only when the table has no row: `npx shadcn@latest add <name>`.

Rules:

- Never ship the shadcn default state. Radii, color, and type come from the `index.css` tokens, not the component defaults.
- One system. shadcn/ui only. Do not add Radix Themes, Material, or Bootstrap beside it. Base primitives come from `@base-ui/react`, already a dependency.
- Chart geometry is the only new code. `ShareBar`, `BarList`, and `Sparkline` are the exceptions, because shadcn ships no list-bar primitive.
- Do not edit `components/ui/*` except as a deliberate, noted customization. Local deviations live in `components/`.

## Reference

The live dashboard is the reference. Check it at any time.

- <http://127.0.0.1:3847/>. OMP exposes the same server from its `/stats` command.
- Pages are hash routes: <http://127.0.0.1:3847/#/providers?range=7d>.
- Range keys: `1h`, `24h`, `7d`, `30d`, `90d`, `all`. Traces adds `&s=<sessionFile>`.
- Verified on this machine with live data: `/` and every page URL return 200.
- When the live page and a reading of the source disagree, the live page wins. Read the source only for a detail the UI cannot show: `packages/stats/src/client` in `can1357/oh-my-pi`.

Page URLs to open side by side with the Tersio port:

| Page | Live URL |
|---|---|
| Overview | <http://127.0.0.1:3847/#/overview?range=24h> |
| Models | <http://127.0.0.1:3847/#/models?range=7d> |
| Providers | <http://127.0.0.1:3847/#/providers?range=7d> |
| Costs | <http://127.0.0.1:3847/#/costs?range=30d> |
| Requests | <http://127.0.0.1:3847/#/requests?range=24h> |
| Errors | <http://127.0.0.1:3847/#/errors?range=7d> |
| Traces | <http://127.0.0.1:3847/#/traces?range=7d> |
| Tools | <http://127.0.0.1:3847/#/tools?range=7d> |
| Frustration | <http://127.0.0.1:3847/#/frustration?range=30d> |
| Projects | <http://127.0.0.1:3847/#/projects?range=30d> |
| Gain | <http://127.0.0.1:3847/#/gain?range=30d> |

Cross-check surface: `GET /api/stats?range=`, `/api/stats/models`, `/api/stats/providers`, `/api/stats/folders`, `/api/stats/timeseries`, `/api/status`. Live `overall` carries 18 fields. Copy the metrics, not the route shape.

## Non-goals

- Do not write to `~/.omp/stats.db` or `~/.omp/agent/agent.db`. Read-only.
- Do not reimplement the omp SSE stream, the sync worker, or the rollup tables.
- Do not rebuild Tersio-only metrics. Gain and Savings stay Tersio data.
- Do not open a second HTTP port.

## Page inventory

Eleven pages, three nav groups, verified from `client/app/nav.ts` and the live dashboard.

| Page | Blocks and charts |
|---|---|
| Overview | `StatGrid` cost totals, `StatGrid` token mix, `TimeChart` with a metric `Segmented`, `ShareBar` token mix + `Legend`, `ShareBar` agent type + `Legend`, recent-request `Table` with row drill-down |
| Models | `StatGrid`, `TimeChart` with a share/count `Segmented`, `Legend` toggles, `Table` with a `Sparkline` column |
| Providers | `StatGrid`, `TimeChart` burn with a tokens/cost/requests `Segmented`, `Table` with `MeterCell`, `ShareBar` token mix, hour-of-day `Chart` (24 slots), quota-window insight `Table`, per-window account `Chart` + `Legend`, account `Table` |
| Costs | `StatGrid` estimate, average per day, top model, per-request cost, unpriced count, `Chart` of a component `Segmented`, `Legend`, model `Table` with `MeterCell` and per-row `ShareBar`, component `ShareBar` |
| Requests | `StatGrid` requests, failed, tokens, cost, median duration, median TTFT, `SearchInput`, status `Segmented`, `Table` with row drill-down |
| Errors | `StatGrid` failures, signatures, affected models, last failure, signature `Table` with `MeterCell`, model `BarList`, row `Table` |
| Traces | Session-grouped `Table` with a cost `MeterCell` |
| Tools | `StatGrid` calls, distinct tools, error rate, attributed tokens and cost, secondary `StatGrid` on result and argument characters, `TimeChart` top tools with a metric `Segmented`, tool `Table` with `Sparkline` and `MeterCell`, tool x model x provider `Table` |
| Frustration | `StatGrid` coverage and tone rates, model-class `Segmented`, family `Legend` filter, per-class `Chart`, detail `Table` |
| Projects | `StatGrid`, cost `BarList`, request `BarList`, folder `Table` with `MeterCell` |
| Gain | `StatGrid`, saved-token `Chart` with a running total and `Legend`, by-source `Table` with `MeterCell` |

Shared primitives: `Chart`, `TimeChart`, `BarList`, `ShareBar`, `Sparkline`, `Legend`, `StatGrid`, `Stat`, `Table`, `MeterCell`, `Segmented`, `SearchInput`, `Card`, `QueryView`, `ChartSkeleton`. Shell: sidebar nav with hotkeys, range picker on `1`-`6`, live chip, theme toggle, request detail drawer.

Tersio already ships the base: `recharts` 3.8, `dashboard/app/src/components/ui/chart.tsx`, shadcn `Table`, `Card`, `dialog`, `request-drawer.tsx`, `models.tsx`, `tools.tsx`, `recent.tsx`, `savings.tsx`, `agent-logos.tsx`, `brand.tsx`, `format.ts`. Phase 2 builds the missing primitives on top of these.

## Data sources

Three read-only files. One metric has one source.

| Source | Tables | Feeds |
|---|---|---|
| `~/.omp/stats.db` | `messages` (23,847 rows and growing, 26 providers, 58 models at plan time) | Overview, Models, Providers usage, Costs, Requests, Errors, Traces, Projects |
| `~/.omp/stats.db` | `tool_calls` (19,159 rows at plan time) | Tools |
| `~/.omp/stats.db` | `user_messages` (306), `frustration_verdicts` (159) | Frustration |
| `~/.omp/agent/agent.db` | `usage_history` (5,756 rows, 10 subscription providers) | Providers quota windows |
| `~/.tersio/usage.db` and the ledger | Tersio rows | Gain, Savings, RTK adoption |

Verified column facts. Column names are exact and snake_case.

- `messages`: `session_file`, `entry_id`, `folder`, `provider`, `model`, `api`, `timestamp` (ms), `duration`, `ttft`, `stop_reason`, `error_message`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`, `premium_requests`, `cost_input`, `cost_output`, `cost_cache_read`, `cost_cache_write`, `cost_total`, `cost_no_cache_input`, `agent_type`, `cost_unpriced`, `service_tier`. Unique on `(session_file, entry_id)`.
- `tool_calls`: `session_file`, `entry_id`, `tool_call_id`, `folder`, `tool_name`, `model`, `provider`, `timestamp`, `agent_type`, `calls_in_turn`, `args_chars`, `result_chars`, `is_error`. Unique on `(session_file, tool_call_id)`.
- `user_messages`: `session_file`, `entry_id`, `folder`, `timestamp`, `model`, `provider`, `chars`, `words`, `yelling`, `profanity`, `anguish`, `negation`, `repetition`, `blame`, `prose`, `prose_hash`. Unique on `(session_file, entry_id)`.
- `frustration_verdicts`: `prose_hash` (primary key), `p_annoyed`, `p_angry`, `target`, `judge`, `judged_at`.
- `usage_history` in `agent.db`: `recorded_at`, `provider`, `account_key`, `email`, `account_id`, `limit_id`, `label`, `window_label`, `used_fraction`, `status`, `resets_at`. Indexed on `(provider, account_key, limit_id, recorded_at)`.
- Open both databases with the ladder in Opening the databases. Read-only access while omp writes is confirmed.
- Skip `message_rollup`, `tool_rollup`, `session_rollup`, and their dirty-bucket fallback. Raw tables are indexed and small enough.

Taxonomy, from the live data:

- `stop_reason` takes four values: `toolUse` 21896, `stop` 1470, `error` 311, `aborted` 154. Only `error` is a failure.
- `agent_type` takes three values: `main`, `subagent`, `advisor`. Labels: Main agent, Subagents, Advisor.
- `service_tier` is null on every row and `premium_requests` is zero on every row. Hide both columns instead of rendering empty ones. Revisit if omp starts recording them.
- `cost_unpriced` is zero on every row today, and no provider is named `xai-oauth`. Keep the rule anyway, so the unpriced count matches the reference the moment a subscription route appears.
- `folder` is a slug such as `-Documents-Projects-Personal-tersio`. 17 distinct values today. The reference prints the slug as it stands, so Tersio prints it too. Prettifying it is an explicit Phase 4 change, not a Phase 3 one.

## Metric contract

Every rule below was verified against `http://127.0.0.1:3847/api/stats?range=all` read at the same row count as the SQL. `Σ` means a SQL `SUM` or `TOTAL` over the rows in range.

| Metric | Rule |
|---|---|
| `requests` | `count(*)` |
| `failed` | `count(stop_reason = 'error')` |
| `successful` | `requests - failed`. `toolUse`, `stop`, and `aborted` all count as successful |
| `errorRate` | `failed / requests`, and `0` when `requests` is `0` |
| `cacheRate` | `Σ cache_read_tokens / (Σ input_tokens + Σ cache_read_tokens)`, `0` when the denominator is `0` |
| `cacheSavings` | `(N - C) / N`, `0` when `N` is `0`, where `N = Σ cost_no_cache_input` and `C = Σ (cost_input + cost_cache_read + cost_cache_write)` over rows with `cost_no_cache_input > 0` |
| `avgDuration` | `Σ duration / count(duration)`. `count` skips nulls |
| `avgTtft` | `Σ ttft / count(ttft)` |
| `avgTokensPerSecond` | `Σ (output_tokens * 1000 / duration)` over `duration > 0`, divided by `count(duration)` |
| `totalCost` | `Σ cost_total` |
| `unpricedRequests` | `Σ (total_tokens > 0 AND cost_total = 0 AND (provider = 'xai-oauth' OR cost_unpriced = 1))` |
| `conversationTokens` | `input + output + cache_read + cache_write` |

Two traps worth naming: the `cacheSavings` numerator only takes rows with a real `cost_no_cache_input`, because 21,403 of 23,847 rows carry `0` there and would otherwise swamp the ratio. The `avgTokensPerSecond` denominator is `count(duration)`, not the count of rows with `duration > 0`.

## Series

- Buckets are epoch-aligned: `floor(timestamp / bucketMs) * bucketMs`.
- Bucket size by range: `1h` 5 minutes, `24h` 1 hour, `7d`, `30d`, `90d`, `all` 1 day. The reference caps a series at 1500 buckets.
- Bucket labels are UTC, matching the reference's `UTC_DAY` formatter. Do not label with the machine zone or the two dashboards will disagree. The hour-of-day chart is the one exception: it reads local hours, as the reference does.
- Only buckets with data are returned, and gaps stay gaps. Verified against the reference: a 30 day window returns 22 points, not 30, and the chart connects them. Do not densify.

## Data drift and test seams

- `messages` grows while omp runs. It moved from 23,731 to 23,847 rows during this planning session. Compare the two dashboards at the same row count, or pin a range and read both sides within the same minute. Never compare a saved number against a fresh one.
- Add env seams so tests point at fixtures: `TERSIO_OMP_STATS_DB` and `TERSIO_OMP_AGENT_DB`, alongside the existing `TERSIO_USAGE_DB` pattern.
- Add fixture builders that create both databases with the schema above, so the aggregate tests run with no omp install present.
- The reference server may be down. Start it with `omp stats` before a cross-check. Record the row count from `/api/stats?range=all` beside each comparison.

Degrade per source: a missing `stats.db` hides the omp pages, a missing `usage_history` hides only the Providers quota half. Users on pi or OpenCode keep the current dashboard.

### Opening the databases

Both omp databases run in WAL mode. This has a verified trap, so follow the ladder exactly.

1. `sqlite3 -readonly <path> "PRAGMA query_only=ON; ..."`. This is the normal path and it works while omp is writing.
2. `-readonly` fails with `unable to open database file (14)` when the `-shm` and `-wal` side files are absent, because sqlite cannot recover the log without write access. Confirmed by copying `stats.db` alone to a temp directory.
3. On that failure, when no `<path>-wal` exists, retry as `file:<path>?immutable=1`. That reads the quiesced file.
4. When a `<path>-wal` does exist, copy `<path>`, `<path>-wal`, and `<path>-shm` into a temp directory and `-readonly` the copy. Verified: the copy returns the same row count as the live API.
5. Never open with `immutable=1` while a `-wal` file exists. It silently ignores the log and under-reports: it returned 23809 rows where the live API returned 23847.
6. Never open plain, read-write, even with `PRAGMA query_only=ON`. It creates `-shm` and `-wal` side files in the directory, confirmed on a copied database.

Create test fixtures with `PRAGMA journal_mode=DELETE` so no WAL is involved and `-readonly` works on them.

## Brand marks

Two marks, two jobs, never merged.

- `VendorMark` names the model's author: DeepSeek, Meta, Alibaba, Google, Anthropic.
- `ProviderMark` names the routing service that served the request: commandcode, magpie, kilo, openrouter.

Why separate: at plan time 10 of the 26 live providers served more than one vendor (amd-radeon-cloud-cn, b.ai, charm-hyper, commandcode, gmi-cloud, google-antigravity, groq, kilo, magpie, nvidia). `commandcode` alone served Stealth 4649 rows, DeepSeek 1000, Meta 392. One mark cannot state both facts. Re-derive the set from the live provider list in Phase 1.

### Resolution

`VendorMark` order: model id regex (the existing `PROVIDERS` table in `lib/format.ts`), then the vendor map keyed by provider id, then a monogram.

`ProviderMark` order: the provider map, then a monogram of the provider name in the provider color.

The model label already reads vendor-first (`Anthropic - Claude - Sonnet-5`), so the vendor mark pairs with text that says the same thing.

### Provider ledger, from the live data

| Provider | Rows | Mark | Note |
|---|---|---|---|
| commandcode | 6852 | monogram | neutral gateway |
| opencode-zen | 3364 | monogram | neutral gateway |
| b.ai | 2566 | monogram | neutral gateway |
| magpie | 2350 | monogram | neutral gateway |
| inferx | 1854 | monogram | neutral gateway |
| amd-radeon-cloud-cn | 1753 | AMD | confirm the official AMD mark |
| kimi-code | 1698 | Moonshot | vendor-branded route |
| charm-hyper | 717 | monogram | neutral gateway |
| gmi-cloud | 711 | monogram | neutral gateway |
| kilo | 699 | monogram | neutral gateway |
| openai-codex | 617 | OpenAI | vendor-branded route |
| tokenrouter | 178 | monogram | neutral gateway |
| nvidia | 158 | NVIDIA | vendor-branded route |
| google-antigravity | 90 | Google | vendor-branded route |
| devin | 84 | Cognition | vendor-branded route |
| openrouter | 58 | monogram | neutral gateway |
| yolo-auto | 30 | monogram | neutral gateway |
| ollama-cloud | 20 | Ollama | confirm the official Ollama mark |
| cline | 8 | Cline | confirm the official Cline mark |
| github-copilot | 3 | GitHub | vendor-branded route |
| groq | 2 | Groq | confirm the official Groq mark |
| tokenharbor | 1 | monogram | neutral gateway |
| poolside | 1 | Poolside | confirm the official Poolside mark |
| opencode-go | 1 | monogram | neutral gateway |
| cerebras | 1 | Cerebras | confirm the official Cerebras mark |
| 9router | 1 | monogram | neutral gateway |

Every `confirm` entry is resolved in Phase 1 against the service's own brand page. A provider with no findable mark keeps its monogram. Never a guess and never another vendor's logo.

### Missing vendor ids to close in Phase 1

The model regex misses 11 model ids, 3560 rows at plan time. Each row is a vendor decision plus a mark. Re-run the check in Phase 1, because the table moves.

| Rows | Provider | Model id | Proposed vendor |
|---|---|---|---|
| 1662 | kimi-code | `k3` | Moonshot |
| 1404 | magpie | `opencode-zen/step-5-preview-free` | StepFun |
| 334 | commandcode | `typesafe/jev` | Typesafe |
| 100 | commandcode | `meituan/LongCat-2.0:free` | Meituan |
| 43 | openrouter | `~typesafe/jev-latest` | Typesafe |
| 12 | commandcode | `poolside/laguna-s-2.1-free` | Poolside |
| 1 | kilo | `tencent/hy3:free` | Tencent |
| 1 | 9router | `cbai/hy4-preview` | unknown, monogram |
| 1 | opencode-go | `ox-alpha-free` | unknown, monogram |
| 1 | opencode-zen | `union-alpha` | unknown, monogram |
| 1 | poolside | `poolside/laguna-s-2.1` | Poolside |

Confirm each proposed name on the model's own page before the regex is added. An unconfirmed id gets the monogram fallback.

### Assets: bundle, never fetch

Every mark ships in-repo as an inline asset. No runtime network call.

- `dashboard --export` inlines the bundle and `brand.webp` as a data URI, so the exported file must stay self-contained.
- Two remote URLs break that today: `https://cdn.simpleicons.org/<slug>/white` at `brand.tsx:81` and `brand.tsx:137`, and the InclusionAI avatar on `cdn-avatars.huggingface.co` at `brand.tsx:10`.
- Fix: a dev-only script fetches each slug once into `dashboard/app/src/lib/marks/<slug>.svg`, and the component imports the file. The CDN stays the oracle in the script, never in the component.
- Guard test: no component under `dashboard/app/src` references a remote logo host.

### Theme

- Monochrome marks render as a CSS mask filled with `currentColor`, the pattern already used by `agent-logos.tsx` and `MaskedGlyph`.
- `/white` is hardcoded today, so a white glyph lands invisible on a light surface. The mask approach removes the problem.
- A mark with official color keeps that color inside a neutral tile, and the tile passes contrast in both themes.
- Tiles keep the existing scale: `size-[40px] rounded-[12px]`, small `size-8 rounded-[10px]`, glyph 22px and 17px.

### Fallback chain

Official mark, then monochrome mask, then a monogram tile with the initial and the provider color, then a generic glyph. Never a broken image, never an empty tile, never a vendor mark on a neutral gateway.

### Accessibility

`aria-hidden="true"` on the mark, empty `alt`, and the vendor or provider name always present as text in the same row. No mark stands alone, and no label prints under a logo.

### Provenance

`dashboard/app/src/lib/marks/SOURCES.md` records the origin URL, the license, and the retrieval date for each file. Simple Icons files are CC0. The trademarks stay with their owners and the use is nominative.

## Page fate

| omp-stats page | Tersio action |
|---|---|
| Overview | New section. Reuse `hero.tsx` for the stat strip, add the activity chart and mix bars |
| Models | Extend `models.tsx` with TTFT, tokens/s, cache rate, cost, and the sparkline column |
| Providers | New page. Usage half from `messages`, quota half from `usage_history` |
| Costs | New page. Copy the split selector and per-row `ShareBar` idea |
| Requests | Promote `recent.tsx` to a full page with search, status filter, and the existing drawer |
| Errors | New page. Group by normalized error signature |
| Traces | New page. Group `messages` by `session_file` |
| Tools | Extend `tools.tsx` with error, argument, and result-character columns |
| Frustration | New page. Needs the behavioral metrics and verdict tables |
| Projects | New page. `folder` breakdown |
| Gain | Fold into the existing `savings.tsx`. Same metric, so no second copy |

## Payload contract

Extend the snapshot with one `omp` section. `UsageReport` stays untouched.

```ts
interface OmpStats {
  available: boolean;
  range: RangeKey;
  overall: Overall;                 // requests, failed, errorRate, token buckets, cacheRate, cacheSavingsUsd,
                                   // costUsd, unpricedRequests, avgDurationMs, avgTtftMs, avgTokensPerSecond
  byProvider: Row[]; byModel: Row[]; byProject: Row[]; byAgentType: AgentShare;
  series: Bucket[];                 // tokens, costUsd, requests, errors, per bucket
  seriesByProvider: Series[];       // burn chart
  hourOfDay: Bucket[];              // 24 slots
  topModels: Row[];                 // for the Costs table and sparklines
  recent: RequestRow[];             // ts, provider, model, project, tokens, durationMs, ttftMs, costUsd,
                                   // unpriced, stopReason, errorMessage, agentType, sessionFile, entryId
  errorGroups: ErrorGroup[]; errorModels: Row[];
  traces: TraceRow[];               // sessionFile, entries, tokens, costUsd, unpriced, firstTs, lastTs
  tools: ToolRow[]; toolsByModel: ToolRow[];
  windows?: WindowInsight[];        // quota half, absent when usage_history is missing
  frustration?: Frustration;        // absent when the tables are empty
}
```

Write both sides in TypeScript: `OmpStats` in `dashboard/app/src/lib/data.ts`, the producer in `extensions/shared/omp-stats.ts`.

Two additions the pages needed, beyond the sketch above: `byModel` is grouped by model and provider, matching the reference row for row, and `modelSeries` carries the per-model token trend for the sparkline column. Both were confirmed against `/api/stats` before they shipped.

## Phases

### Phase 1 - aggregate, marks, and serve

Files: `extensions/shared/omp-stats.ts` (new), `dashboard/app/src/lib/marks/*` (new), `brand.tsx`, `format.ts`, `cli/dashboard.ts`, `dashboard/app/src/lib/data.ts`.

1. Add `readOmpStats(range)` returning `OmpStats`. One read-only batch per source, per the ladder in Opening the databases.
2. Add `readUsageWindows()` for `usage_history`. Return `undefined` on any failure.
3. Guard every division: error rate, cache rate, cache savings, tokens per second.
4. Extend `dataJson()`, `/data.json`, and add `/api/omp?range=`.
5. Vendor each mark into `lib/marks/`, add `SOURCES.md`, and switch `brand.tsx` off the CDN.
6. Build the provider map and the vendor mark map. Close the 11 missing model ids.
7. Add the guard test on remote logo hosts.
8. Add the `TERSIO_OMP_STATS_DB` and `TERSIO_OMP_AGENT_DB` seams, the fixture builders from the schema above, and the opening ladder from Data sources.

Acceptance: `curl 127.0.0.1:<port>/data.json` reports `omp.overall.requests` equal to the sqlite count for that window, and equal to `overall.totalRequests` from <http://127.0.0.1:3847/api/stats?range=24h>. No component in `dashboard/app/src` fetches a logo over the network. The mtime and size of both omp databases are unchanged after a full sync.

### Phase 2 - chart primitives

Files: `dashboard/app/src/components/charts/*.tsx` (new).

Build `TimeChart`, `Chart`, `BarList`, `ShareBar`, `Sparkline`, `Legend`, `MeterCell`, `StatGrid`, `Stat`, and `Segmented` on top of the installed shadcn pieces, per the mapping table. `ui/chart` already wraps `recharts`, and `ui/toggle-group` already covers `Segmented`, so the new code is chart geometry and layout only. One series palette, one tooltip, one empty state. No page builds its own chart.

Acceptance: a scratch route renders each primitive with fixture data, and `git diff --stat dashboard/app/src/components/ui` is empty.

### Phase 3 - pages

Files: `dashboard/app/src/components/omp/*.tsx` (new), `models.tsx`, `tools.tsx`, `recent.tsx`, `App.tsx`.

1. Overview, Models, Providers usage, Costs, Requests, Errors, Projects.
2. Traces: session-grouped table with cost, tokens, and a drill-down into the drawer.
3. Tools and Models extensions.
4. Providers quota half: utilization series, window insights, account table.
5. Frustration: coverage stats, class filter, per-class chart, detail table. Read the stored columns in `user_messages` and join `frustration_verdicts` on `prose_hash`. Do not port `user-metrics.ts`, because omp already stores the results.
6. Shell: sidebar nav with the `g`-then-letter hotkeys, range keys `1`-`6`, live chip.
7. Wire `ProviderMark` into the Providers, Models, and Requests tables, and `VendorMark` into every model cell.

Acceptance: every page renders real numbers. For each row of the URL table in Reference, open the live page and the matching Tersio page on the same range, then compare three cells. Every provider row shows a mark or a monogram, none empty. Every control comes from the shadcn mapping table.

### Phase 4 - polish and docs

1. Empty states for a missing source and for an empty window.
2. Apply `useFx` at the edge. Range math stays in USD.
3. Update `docs/ARCHITECTURE.md`, the dashboard section of `README.md`, and `CHANGELOG.md`.

## Verification

- `bun run build` and `bun run test` pass. The reported eleven failures on `main` were a stale `dashboard/dist`: twelve tests spawn the compiled CLI or read the exported bundle, so a build first turns the suite green. After `bun run build`, the suite is 404 passed, 0 failed.
- Open <http://127.0.0.1:3847/> and the Tersio dashboard with real data. Screenshot each page pair.
- Cross-check five aggregates per page against the read-only sqlite path and against the live page.
- Confirm `stats.db` and `agent.db` mtimes and sizes stay unchanged after a dashboard session.
- Check every mark in both themes, and check the export with the network off.
- `bun run lint:dashboard` passes, and `git diff --stat dashboard/app/src/components/ui` stays empty.
- Check all twelve rules in Metric contract against `/api/stats` at a matched row count.
- Keyboard pass: range keys `1`-`6`, the `g` hotkeys, drawer open and close, table header focus.

## Risks

| Risk | Mitigation |
|---|---|
| WAL locking, or a missing `-shm` blocking a read | The ladder in Opening the databases. `-readonly` first, then the copy path |
| A stale read from `immutable=1` over a live WAL | Only use `immutable=1` when no `-wal` file is present |
| Schema drift across omp releases | Probe `PRAGMA table_info` once. Hide unsupported columns instead of failing |
| Double counting against the Tersio ledger | omp pages read the omp databases only. Label each section by source |
| Cost read as a bill | Reuse the omp-stats wording: public rate card, estimate only |
| A large `all` window | Aggregate in SQL, cap table rows, never load every message into memory |
| Frustration judge coverage | Verdicts cover a subset of user messages, 159 of 306 at plan time. Label the regex fallback in the UI |
| A wrong vendor mark | Monogram fallback. A neutral gateway never wears a vendor logo |
| A remote logo breaking the export | Bundled marks plus the guard test |
| Rebuilding a control shadcn already ships | Check the shadcn mapping table and `components/ui` first, then add via `npx shadcn@latest add` |
| Drifting from the shadcn look, or shipping its defaults | Customize through `index.css` tokens, and keep `components/ui` untouched |
| A metric drifting from the reference | Use the table in Metric contract, and check against `/api/stats`, never against the rendered page |
| Comparing against a database that grows mid-check | Read the row count from `/api/stats?range=all` and match it on both sides |
| A chart with no accessible name | Every chart carries a text summary, the sidebar is keyboard reachable, and tables keep header scope |

## Decisions

Settled points, so no phase blocks on an open question.

1. Layout: one scroll page with a sidebar that jumps to a section, matching the current dashboard. No router. The range lives in the URL hash, so a shared link reproduces the view.
2. Frustration: read the stored `user_messages` columns and join `frustration_verdicts` on `prose_hash`. Judge coverage is the share of user messages whose `prose_hash` has a verdict. No port of `user-metrics.ts`.
3. Frustration model-class axis: the reference calls omp's `classifyModel` taxonomy, which Tersio does not have. Use the existing vendor map from `lib/format.ts` as the axis and label it "Vendor". Note the deviation in the UI copy. Do not fake the reference taxonomy.
4. Marks with no confirmed official asset: ship the monogram in Phase 1, and add the official asset in Phase 4 once the source is confirmed. Never guess a logo.
5. `service_tier` and `premium_requests` are hidden, because every row is null or zero. Revisit when omp starts recording them.
6. Traces: group by `session_file`. Accept the reference's `&s=` deep link and select the matching row; do not build a separate trace view.
7. Writes: none. Every source is read-only, and no code path may create a table, an index, or a WAL checkpoint in the omp databases.

## Verified in the build

Read from the running dashboard and the reference, at the same row count, on all six ranges.

| Check | Result |
|---|---|
| `bun /tmp/check-omp.ts <range>` against `/api/stats` | 18 overall figures, 63 model rows, 26 provider rows, the bucket timestamps and all four bucket values, every tool row, and the five frustration counts matched on `1h`, `24h`, `7d`, `30d`, `90d`, and `all` |
| Every page, live | 11 sections, 11 rail items, 24 tables, no console error |
| Range switch, `1`-`6` keys, `g` then a letter | window moves and the hash follows; jump lands the section 96px below the Dock |
| Drawer | opens on a request row, closes on Escape |
| Light and dark | checked in the rail, the tables, the marks, and the charts |
| Export | 2.5 MB self-contained file, renders from `file://` with no logo request |
| Missing `stats.db` | 5 rail items, Tersio sections intact, no board of zeros |

Two defects the live pass caught, both fixed: the chart primitive drew its own legend on top of the page's, and the provider and model tables derived throughput from a total output count instead of the payload's `avgTokensPerSecond`.

## Definition of done

- `bun run build` passes, and `bun run test` is 404 passed, 0 failed.
- All eleven pages render against live data, and each one matches the reference on three cells, read at the same row count.
- Every control comes from the shadcn mapping table, and `git diff --stat dashboard/app/src/components/ui` is empty.
- Every metric matches the table in Metric contract, checked against `/api/stats`, not just against the page.
- No component under `dashboard/app/src` fetches a logo over the network, and the export renders with the network off.
- Every provider row shows a mark or a monogram, and no neutral gateway wears a vendor logo.
- Zero em-dashes in UI copy, and zero in this plan.
- `stats.db` and `agent.db` are byte-identical after a full dashboard session.
- `docs/ARCHITECTURE.md`, `README.md`, and `CHANGELOG.md` updated.

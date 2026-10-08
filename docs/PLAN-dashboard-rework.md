# Plan — Dashboard rework: sidebar shell, OMP-stats page set, pricing ledger rework

Status: Phases 0–5 delivered (§13), range windows (§14), session traces (§15) and the OMP parity
gap list (§16) delivered.
On `feat/dashboard-rework`; `extensions/shared/session-trace.ts` is committed, the rest of the
rework is still working-tree.

References used:
- OMP stats source: `github.com/can1357/oh-my-pi` — `packages/stats/`
- Local OMP stats app: `http://127.0.0.1:3847/#/overview?range=all` (could not be fetched from this
  environment; port 3847 is an internal address and was blocked. Findings come from the source tree
  and the pasted sidebar screenshot.)
- Sidebar screenshot: 3 groups, 11 pages.

---

## 1. Design read

Per the `design-taste-frontend` skill, before any code:

> **Reading this as:** local developer-tool analytics dashboard for a single technical operator,
> with a dense-cockpit / Linear-ish language, leaning toward the existing shadcn/ui + Tailwind v4 +
> Recharts stack.

**Dials:** `DESIGN_VARIANCE: 4` · `MOTION_INTENSITY: 3` · `VISUAL_DENSITY: 8`

Density 8 is deliberate. The skill's own table for that level says: tight paddings, no generic card
boxes, 1px lines separate data, `font-mono` for all numbers. That is both what OMP looks like and
what "CRM / SaaS dashboard" means here.

### 1.1 Skill scope — applied vs dropped (honesty rule)

The skill's scope line reads "Landing pages, portfolios, and redesigns. **Not dashboards, not data
tables, not multi-step product UI.**" Its rules are contextual and none fire automatically. So:

**Applied**

- Brief inference + one-line design read (above).
- One accent color, locked for the whole app. No second accent per page.
- Shape consistency lock: one radius scale, declared once.
- Page theme lock: one theme for the whole app; no section inverts.
- No pure black / pure white backgrounds.
- Full interactive states: loading skeletons, empty states, error states, `:active` feedback.
- WCAG AA contrast audit on every button, badge, form control, and stat label.
- Icons: one family. The project already depends on `lucide-react` and `components.json` pins
  `iconLibrary: lucide`, so lucide stays. No second icon family gets mixed in.
- Motion must be motivated. Valid reasons here: state transition, feedback, live-data arrival.
- No `window.addEventListener("scroll")`. No `requestAnimationFrame` loops touching React state.
- Respect `prefers-reduced-motion`.
- No emoji in dashboard markup. The CLI status strings carry emoji; the dashboard renders those as
  icons instead.
- Real empty/error states instead of a generic spinner.

**Dropped, with reason**

- Hero rules, eyebrow limits, bento rules, marquee cap, zigzag cap, quotes, serif discipline,
  logo walls, "needs real images". These target marketing pages. There is no hero and no imagery in
  an analytics dashboard.
- "Redesign — overhaul: VARIANCE +2, MOTION +2". Applies to marketing redesigns, not this.
- Font swap. The skill discourages `Inter` as a default, but the project already ships
  `@fontsource-variable/inter` and the skill's own override says Inter is acceptable when the
  project already depends on it. Font work is explicitly out of scope.

---

## 2. What the references actually give us

### 2.1 Sidebar (from the screenshot)

| Group | Page |
|---|---|
| Usage | Overview, Models, Providers, Costs |
| Activity | Requests, Errors, Traces |
| Insights | Tools, Frustration, Projects, Gain |

### 2.2 OMP backend files (what each does, so we adopt the idea and not the code)

| File | Size | Role |
|---|---|---|
| `db.ts` | 63K | SQLite schema, rollups, queries |
| `parser.ts` | 25K | Session JSONL → rows |
| `rollup.ts` | 38K | Hourly rollup maintenance, dirty-hour tracking |
| `trace.ts` | 43K | Span extraction and timeline |
| `aggregator.ts` | 24K | Overall + per-breakdown stats |
| `frustration.ts` | 18K | Frustration heuristics |
| `gain-aggregator.ts` | 10K | Savings/gain math |
| `usage-windows.ts` | 14K | Rate-limit / window tracking |
| `user-metrics.ts` | 19K | Per-user metrics |
| `live.ts` | 9K | SSE live updates |
| `server.ts` | 18K | HTTP API |
| `port-conflict.ts` | 11K | Port fallback |

Client: `client/app/Shell.tsx`, `client/app/nav.ts`, `client/routes/*Route.tsx` (11 routes),
`client/charts/*` (own SVG chart layer), `client/traces/*` (span waterfall), `client/ui/*`,
`client/styles.css` (33K).

### 2.3 OMP metrics and how each is computed

| Metric | OMP formula | Data needed |
|---|---|---|
| Tokens/s | `output_tokens / (duration/1000)` | `duration` (derived on pi, native on omp) |
| Cache Rate | `cache_read / (input + cache_read) * 100` | tokens only |
| Cache Savings | `(uncached prompt cost - actual prompt cost) / uncached prompt cost * 100` | tokens + prices |
| Error Rate | `count(stopReason=error) / total_calls * 100` | `stopReason` |
| API-equivalent estimate | tokens × matching public API rate card | prices |
| Avg Latency | mean of `duration` | `duration` (derived on pi, native on omp) |
| TTFT | mean of `ttft` | `ttft` (omp only) |

### 2.4 OMP's pricing semantics — the part worth copying exactly

From the OMP README:

> Subscription-backed models use matching public API prices when an exact public model exists; these
> values estimate API-equivalent usage rather than the user's bill. Subscription-only models without
> a public price are reported as N/A and **excluded from dollar totals**.

Two rules there, and we currently break both. See §5.

---

## 3. Feasibility: which OMP pages Tersio can actually populate

**Correction to the first draft of this plan.** It claimed pi emits no latency data, so latency and
TTFT were OMP-only. That was wrong about latency. `classifySessionLine` derives elapsed wall clock
from the `message.timestamp` to `completedAt`/row-timestamp pair, so `duration` is already populated
for every host. Measured in `~/.tersio/usage.db` before the rework:

| Host | rows | rows with `d` | coverage |
|---|---|---|---|
| omp | 10,061 | 10,056 | 99.95% |
| opencode | 11,838 | 11,838 | 100% |
| pi | 8,269 | 8,268 | 99.99% |

Only **TTFT** is genuinely OMP-only. And one semantic caveat: the derived figure is elapsed wall
clock between the message timestamp and completion, not model inference latency. A 96-minute pi row
exists in the data. Any latency page must label it as elapsed, not as inference time.

Raw field occurrences across all session JSONL files on this machine:

| Field | pi (`~/.pi/agent/sessions`, 5 files) | omp (`~/.omp/agent/sessions`, 20 files) |
|---|---|---|
| `stopReason` | 1175 | 2242 |
| `cwd` | 22 | 409 |
| `completedAt` | 1 | 2050 |
| `duration` | **1** | 1441 |
| `ttft` | **0** | 1158 |
| `errorStatus` | 0 | 4 |
| vendor `cost` | 0 | 0 |

`duration` reading as 1 for pi is what caused the wrong conclusion: pi does not write the field, but
the parser derives it from the timestamp pair.

| OMP page | Tersio data today | Verdict |
|---|---|---|
| Overview | totals, messages, cache rate, savings | **ADOPT** |
| Models | `byModel`, `byModelUsd`, `byModelBucketUsd`, `byModelMessages`, `byDayModel` | **ADOPT** |
| Gain | `rtkGain`, `rtkAdoption`, `rtkRecall` — already the richest data we have | **ADOPT** |
| Requests | `recent` (2000 rows) + existing `RequestDrawer` | **ADOPT** |
| Tools | `byTool` + `rtkGain.byCommand` | **ADOPT** |
| Costs | tokens per day exist; cost per day does not; pricing semantics wrong | **ADOPT after §5 + per-day cost** |
| Errors | `stopReason` is present and already parsed into `st`, but never aggregated | **ADOPT after aggregation** |
| Providers | derived from the pricing catalog entry per folded model label, stated in-page | **ADOPTED** |
| Projects | session header `cwd` lands in `byDayProject`; recent rows carry no cwd (honest-empty note on short ranges) | **ADOPTED** |
| Traces | span timing IS in the transcripts: message timestamps, `completedAt`, `tool_execution_start`, `toolResult` (pi falls back to row write time) | **ADOPTED — §15** |
| Frustration | measured interruption/recovery signals shipped (§13.2); LLM judging still needs validated heuristics | **PARTIAL** |

Score at proposal: 5 adopt outright, 3 adopt after a data change, 2 deferred. Re-scored at
delivery: Traces adopted (§15).

### 3.1 Provider is derivable (evidence)

pi writes it explicitly:

```json
{"type":"model_change","id":"4cf8afb9","provider":"opencode","modelId":"space-bunny-free"}
```

omp writes only a prefixed model id:

```json
{"type":"model_change","id":"04f8b7ea","model":"apmixai/deepseek-v4-flash-free","role":"default"}
```

So `provider = model_change.provider ?? first segment of modelId`. `classifySessionLine` already
handles a `provider` field for the codex path, so the plumbing exists.

---

## 4. Prerequisite fixes (blockers, do first)

### 4.1 Dark mode — checked, NOT broken (this finding was wrong)

**Correction.** An earlier draft called this a blocker: that `.dark` is never applied, so every
shadcn token stays light and a sidebar would render light-on-dark. That was a misdiagnosis. The
evidence for it was this grep:

```
grep -c "dark:" components/ui/sidebar.tsx   # 0
```

Zero `dark:` classes in `sidebar.tsx` is correct, because it reads semantic tokens (`bg-sidebar`,
`border-sidebar-border`) that the `.dark` block overrides. And the conclusion that `.dark` is never
applied came from grepping `classList.add("dark")`, which cannot match the real call:

```ts
// components/theme-provider.tsx — applyTheme
root.classList.remove("light", "dark")
root.classList.add(resolvedTheme)
```

The class is added from a variable, so the grep passed over it. Both token systems are wired:

| System | Light | Dark |
|---|---|---|
| shadcn tokens + `dark:` variant | `:root` | `.dark` class, added by `applyTheme` |
| Tersio tokens | `:root` | `html[data-theme="dark"]`, plus a `prefers-color-scheme` fallback while `data-theme` is absent |

Pinned by `dashboard/app/test/theme.test.tsx`, which asserts the class is added for `dark`, swapped
for `light`, and resolved to a concrete class in `system` mode. Fixing a non-bug would have been
churn, and redefining the shadcn block under `html[data-theme="dark"]` would have been a second
mechanism for something that already works.

One real observation, left alone deliberately: theme state is expressed twice, as a class and as an
attribute.

### 4.2 No routing exists

`App.tsx` is a single vertical scroll: `Dock`, `Hero`, `Savings`, `Activity`, `Models`, `Recent`,
`Tools`, `Footer`. There is no router and no route state.

### 4.3 The build is one inlined HTML file

`vite-plugin-singlefile` with `assetsInlineLimit: 100MB`. Current bundle: 2,113.61 kB (729.57 kB
gzip). There is no code splitting, so 11 routes ship in one file. This is a real constraint on
adding chart libraries.

### 4.4 `dialogs.tsx` is 1488 lines

One file holds the settings dialog plus seven panes it composes. It is the largest file in the
dashboard and has to be split before routes multiply.

---

## 5. Pricing ledger rework (the "logic" item)

### 5.1 What is wrong now

`pricing.ts` resolves a price by exact id → provider prefix → suffix → `MODEL_ALIASES`, and on total
failure returns `DEFAULT_PRICE` (Sonnet-class `2 / 10 / 0.2 / 2.5`) with `known: false`.

Then `summarizeUsage` in `cli/usage.ts` does this:

```ts
const c = usdCost(t, model);
usd += c.usd;
if (!c.priced) priced = false;
```

**Every unpriced model is added to the grand total at Sonnet rates.** This box has models like
`apmixai/deepseek-v4-flash-free` and `space-bunny-free`, whose real vendor cost is 0. So the
headline dollar figure is inflated by models we cannot price, and the only signal is a boolean flag.

That is the opposite of OMP's rule, and it is the reason the "cost" number does not currently mean
anything defensible.

### 5.2 Target semantics: three numbers, never blended

| Number | Meaning | Source |
|---|---|---|
| `actualUsd` | What was really billed | sum of vendor-reported `cost.total` (already tracked as `costMeasured`) |
| `apiEquivUsd` | What this usage would cost at public API rates | priced models only; `N/A` rows **excluded** |
| `savedUsd` | Cache-read delta + RTK savings | `cacheRead × input price` + `rtkGain.saved` |

Rules:
1. An unpriced model contributes **zero** to `apiEquivUsd` and is listed in `unpriced: { model,
   tokens, messages }[]`.
2. `apiEquivUsd` is always reported with its coverage: `62 / 74 models priced`. A number without
   coverage is not a number.
3. `DEFAULT_PRICE` stops being a fallback that feeds totals. It may survive as a clearly-labelled
   display-only estimate on a single model row, never in an aggregate.
4. Never render `actualUsd` and `apiEquivUsd` in the same tile as if they were one figure.

### 5.3 Also review

- `FREE_SUFFIX = /(?::free|-free)$/i` strips `-free` before aggregation, so `space-bunny-free` and
  `space-bunny` merge into one row. If those have different public prices, the merge is wrong. Decide
  deliberately: merge for display, not for pricing.
- `MODEL_ALIASES` has exactly one entry. The `unpriced` list from rule 1 is what will tell us which
  aliases actually matter, instead of guessing.
- Cache savings currently use `priceFor(model).price.input` even when `known: false`, so the saved
  figure inherits the same Sonnet-rate fiction. Gate it on `known`.

---

## 6. Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| Shell | shadcn `sidebar.tsx` (already installed, 21.1K) + `SidebarProvider`, `main` = `SidebarInset` | Already in the tree; no new dependency |
| Nav source | One `nav.ts` array (group, label, icon, href) | OMP has 11 routes; duplicating the list is the classic drift bug |
| Routing | Hash routing (`#/overview?range=all`), no router dependency | Matches the OMP URL shape the user referenced; keeps the single-file build working |
| Range | `?range=` in the hash, sliced client-side from one payload | Avoids a server-side query layer for now |
| Charts | Keep `recharts` (already a dependency) + existing `ui/chart.tsx` | Do **not** port OMP's hand-rolled SVG chart layer |
| Styles | Tersio's existing tokens | Do **not** port OMP's 33K `styles.css` |
| Data | Keep `/data.json`; add `/api/traces` only if Traces is ever built | One payload beats six endpoints at this size |
| Port | Fixed default with fallback when taken | The point of a "local hosted link" is that it is stable |
| Settings | Keep `SettingsDialog` as-is; move its trigger into the sidebar footer | Explicit user request |
| Icons | lucide only, `strokeWidth` standardized | Already pinned in `components.json` |

New small composites to build on existing primitives (not new dependencies): `Stat`,
`BarList`, `Sparkline`, `ShareBar`, `Segmented` (from `toggle-group`), `SearchInput`, `JsonBlock`,
`TableShell`, `EmptyState`, `ErrorState`. These mirror OMP's `client/ui` and `client/charts` by
intent, not by code.

---

## 7. Phased work

Each phase ends with `bun run verify` green. One module per commit.

### Phase 0 — Data layer (blocking)

Goal: the pages have something true to render.

1. Fix the dark token scope (§4.1).
2. Capture `cwd` from the session header into a new `byProject` aggregate + `projects` list.
3. Capture `provider` (§3.1) into a new `byProvider` aggregate.
4. Capture `reasoning` tokens if present — the JSONL carries them and we drop them today.
5. Add per-day cost, so Costs can chart money over time and not only tokens.
6. Aggregate `st` into an error summary: counts by status, rate, and the recent error rows with
   `code` / `note`.
7. Capture `duration` / `ttft` **when present**, storing `null` for pi. Every consumer must handle
   `null` as `N/A`, never as `0`.
8. Split `dialogs.tsx` so routes can import individually.

Files: `extensions/shared/usage-ledger.ts`, `extensions/shared/usage-store.ts` (bump
`PARSER_VERSION`, which is `'11'` today, so the mirror rebuilds), `cli/usage.ts`,
`dashboard/app/src/lib/data.ts`.

### Phase 1 — Shell

1. Sidebar with the 3 groups and 11 pages from §2.1.
2. Hash routing + range picker in the header.
3. Move the settings trigger to the sidebar footer; keep the dialog unchanged.
4. Retire `Dock`.
5. Add the shared composites from §6.

### Phase 2 — The 5 ready pages

Overview, Models, Gain, Requests, Tools. All five have complete data today.

### Phase 3 — The 3 pages needing new data

Costs, Errors, Providers. Initials of the pricing rework land here.

### Phase 4 — Pricing rework (§5)

Independent of the UI; can land before, after, or in parallel. Touches
`extensions/shared/pricing.ts`, `cli/usage.ts`, plus the CLI table in `cli/usage.ts` so the terminal
report and the dashboard agree.

### Phase 5 — Polish

Empty states for a fresh install with no sessions, loading skeletons matching each page's real
shape, error state when `/data.json` fails, keyboard nav (`g` then a letter, mirroring OMP),
`prefers-reduced-motion` audit, contrast audit on every stat and badge.

### Deferred

- ~~**Traces.**~~ Reversed: the transcripts do carry span timing. Delivered in §15; the
  "do not build a fake waterfall" rule held — every span comes from a recorded timestamp.
- **Frustration LLM judging.** Needs validated heuristics (retry loops, aborted runs, correction
  patterns). Guessing at this produces a page nobody trusts. The measured subset ships (§13.2).

---

## 8. Non-goals

- No port of OMP's Rust/backend architecture (rollups, dirty-hour tracking, sync worker). Tersio's
  ledger plus `usage.db` mirror is the existing design; this rework does not replace it.
- No SSE live stream in v1. The existing 5s poll already skips hidden tabs.
- No new chart or icon dependency.
- No provider/API integration to fetch real invoices. `actualUsd` stays vendor-reported.
- No changes to RTK wiring, Caveman, Ponytail, or the install path.

---

## 9. Verification

- `bun run verify` (frozen lockfile + build + test) before every commit.
- `bun run lint:dashboard` for the app tree.
- New unit tests for the pricing rules in §5.2 — specifically, that an unpriced model contributes
  zero to `apiEquivUsd` and appears in `unpriced`.
- `test/dashboard/` already exists; page-level tests belong there.
- A parser-version bump test, since changing `PARSER_VERSION` forces a mirror rebuild and a wrong
  bump silently serves stale numbers.
- Manual: dark mode and light mode on every page, because §4.1 exists precisely because that check
  was skipped.

---

## 10. Open questions

1. **Port.** Fixed default (e.g. `3848`) with fallback, or keep ephemeral? A stable link is the
   stated goal, so this needs a decision before Phase 1. *Still open.*
2. **`--port` and the link.** Should `tersio dashboard` print the URL and open a browser by default
   now that the page is navigable? *Still open; `--open` is opt-in today.*
3. **Range semantics.** *Answered (§14):* `1h`, `24h` (default), `7d`, `30d`, `90d`, `all`,
   hotkeys `1`–`6`.
4. **Projects identity.** *Answered:* full `cwd` path in the list, folder basename as the display
   fallback; no sidebar of projects exists to overflow.
5. **Traces.** *Answered (§15):* deferral reversed; a trace shows per-transcript span timing from
   recorded timestamps only.

---

## 11. Honest risk

The largest risk is not the UI. It is that 3 of the 11 pages need new capture, and 2 more may not be
buildable honestly at all. A rework that ships all 11 pages by rendering `0` for missing latency and
TTFT would look complete and be wrong. The plan's ordering exists to prevent exactly that: data
first, then the five pages we can already prove, then the rest as the data arrives.

## 12. Phase 0 status

Implemented and verified on `feat/dashboard-rework`. Not committed.

Captured into `messages` and aggregated into the report:

| Field / aggregate | pi | omp | opencode |
|---|---|---|---|
| `project` (from session `cwd`) | yes | yes | **no** — the message row carries no cwd |
| `provider` | yes, from `model_change.provider` | yes, from the model-id prefix | yes, from the model-id prefix |
| `ttft` | no | yes | no |
| `reason` (reasoning tokens) | yes | no field present | no |
| `duration` (elapsed) | already derived | native | native |

New aggregates: `byProvider`, `byProject`, `byDayModelTokens` (exact input to cost-over-time),
`byDayCost`, `latency` per model, `ttft` per model, `errors` by status, `reasoning` total.

Measured on real transcripts: omp 1226/2055 rows carry a provider and 2055/2055 a project; pi
1221/1221 provider and project. opencode provider resolves through the model id at aggregate time.

### 12.1 Parser version bump: fixed to be lossless

The bump to `PARSER_VERSION = '12'` initially took the `DROP TABLE` path, which rebuilds only from
transcripts still on disk. Measured cost: 19,093 rows became 12,902, a **32% loss** of history from
rotated transcripts. The re-parse guard did not fire, because 0.68 stayed above the 0.5 threshold.

Fixed: an additive bump now `ALTER`s the new columns in place and marks every file stale
(`UPDATE files SET mtime = -1`), so transcripts still on disk are re-read and fill the new columns
while rows whose transcript is gone are kept. Verified against the real store: 19,093 rows preserved,
not 12,902. This also fixes a latent hole where the old in-place path added only `id`, leaving a
table that would fail every insert.

### 12.2 Test suite sandbox

`test/setup.ts` sandboxed pi's agent dir but never Tersio's data dir, so any test that synced the
usage mirror wrote the developer's real `~/.tersio/usage.db` — which is how the bump above first
fired. Now every test file gets a temp `TERSIO_HOME`, `cliEnv()` passes an explicit one, and a
regression test asserts the suite cannot reach the real store. `HOME` is deliberately left alone:
sandboxing it moved Python's user site-packages and silently skipped 8 pyte-backed terminal tests.

### 12.3 Dark mode: checked, not broken

The §4.1 blocker in the first draft was wrong, and no code changed for it. `ThemeProvider.applyTheme`
adds the `dark` class from a variable, which a literal-string grep missed. Pinned by
`dashboard/app/test/theme.test.tsx`: the class is added for dark, swapped for light, and resolved to a
concrete class in system mode.

### 12.4 `dialogs.tsx` split

1488 lines in one file, holding eight internal panes. Split into
`dashboard/app/src/components/settings/`:

| File | Lines | Contents |
|---|---|---|
| `agent-row.tsx` | 64 | `AgentRowProps`, `AgentRow` |
| `health-pane.tsx` | 72 | `HealthPane` |
| `doctor-pane.tsx` | 160 | `DoctorPane` |
| `backup-restore.tsx` | 238 | `BACKUP_SCHEDULES_UI`, `BackupRestore` |
| `data-pane.tsx` | 138 | `ExportFormat`, `EXPORT_FORMATS`, `DataPane` |
| `default-modes.tsx` | 140 | `DefaultsPayload`, `DEFAULT_ROWS_UI`, `DefaultModes` |
| `accent-picker.tsx` | 41 | `AccentPicker` |
| `highlight-match.tsx` | 26 | `HighlightMatch` |

`dialogs.tsx` keeps `SettingsDialog`, `ShareDialog`, `Footer`, and the pane and search tables:
1488 to 646 lines. The extraction was scripted off exact line ranges rather than retyped, because
`ShareDialog` is a 360-line SVG and canvas routine where a transcription slip would be silent. A
coverage check asserted every original line was kept or moved.

Pinned by `dashboard/app/test/settings-dialog.test.tsx`, which mounts the dialog and opens each pane
through the real module boundaries. The build also caught the actual hazard: the extracted symbols
were declared `function X()` rather than `export function X()`, which `tsc -b` reported for all eight
files before any test could run.

### 12.5 Phase 0 result

| Item | State |
|---|---|
| Capture `cwd` into `byProject` | done |
| Capture `provider` | done |
| Capture `reasoning` | done |
| Per-day cost | done |
| Error aggregation by status | done |
| `duration` / `ttft` with `null` for absent | done |
| Lossless parser bump | done |
| Split `dialogs.tsx` | done |
| Dark token scope | not a bug; verified and pinned |

---

## 13. Phases 1–5 delivered

All eleven pages are routed and range-aware. Verified by `bun run verify` at 59 files and 406
tests, plain and under a pty, plus a served instance returning 200 and a `/data.json` carrying every
new aggregate on real data.

### 13.1 Shell (Phase 1)

| Piece | Where |
|---|---|
| Page list, one source of truth | `src/components/app/nav.ts` — 11 pages in 3 groups, each with a jump key |
| Hash routing | `src/lib/route.ts` — `#/<page>?range=<id>`, no router dependency |
| Range-aware aggregation | `src/lib/aggregate.ts` — every page recomputes from per-day tables |
| Sidebar | `src/components/app/app-sidebar.tsx`, shadcn `sidebar.tsx`, `render` prop (this project uses Base UI, not Radix `asChild`) |
| Range picker, shortcuts | `src/components/app/range-picker.tsx`; digits pick a range, `g` then a letter jumps a page |
| Settings in the sidebar footer | `SettingsDialog` unchanged, moved to the footer as requested |
| Primitives | `src/components/dash/composites.tsx`, `trend.tsx` |

Sidebar tokens are mapped onto Tersio's in `index.css`, so one theme drives one palette.

### 13.2 Pages (Phases 2–3)

Overview, Models, Providers, Costs, Requests, Errors, Tools, Gain, Projects, Frustration all read
per-day tables and follow the range. Traces is honest: it states that a span timeline is not in these
transcripts and shows per-request elapsed time instead. *(Superseded by §15 — the real trace UI
replaced that placeholder.)*

Speed, TTFT, and all-time totals are labelled as such where the data is not per-day. `N/A` is used
where a value is absent, never `0`.

### 13.3 Pricing (Phase 4)

The three-number model is in. On this machine the API-equivalent total moved from **$339.63 to
$86.84** with coverage stated as `39/52 models priced` and the 13 unpriced models named. The old
figure was Sonnet-rate fiction for models the price feed does not cover, Space-Bunny alone
contributing about $148 of it.

Per-day money was added server-side (`byDayApiUsd`, `byDaySavedUsd`, `byDayModelUsd`) so cost is
range-aware without shipping the price table to the browser.

### 13.4 Removed

`hero.tsx`, `models.tsx`, and `tools.tsx` were superseded by routed pages and deleted; `useCountUp`
moved to `src/lib/use-count-up.ts`. The activity heatmap and the savings breakdown are preserved on
Overview, labelled all time because a calendar does not follow a range. The bundle got smaller:
2,113.61 kB to 2,074.96 kB, gzip 729.57 kB to 710.87 kB.

### 13.5 Gaps closed while working

- `tsconfig.app.json` included only `src`, so dashboard tests were never type-checked; a bad import
  in a new test passed `tsc -b` unnoticed. Added `tsconfig.test.json` as a referenced project.
- The dashboard vitest project matched `test/**/*.test.tsx`, so a `.test.ts` file never ran. Now both
  extensions match.
- Three CLI tests asserted the old behaviour (the default-price total and deleted component strings)
  and were updated to the new contract; the currency fixture now prices its model in a fixture file
  rather than relying on a fallback.

---

## 14. Range windows delivered

Answers open question 3.

- Six ranges: `1h`, `24h` (default), `7d`, `30d`, `90d`, `all`; hotkeys `1`–`6`.
- `rangeWindow` derives the window start; `rangeView` is the single surface pages read. Short
  ranges (`1h`, `24h`) bucket at 5m/1h from the recent rows and never read the per-day tables —
  `cutoffDay` returns `null` for them, so a day table can never leak into an hour view.
- The recent window is capped at 2000 rows. When that cap truncates the selected window, the page
  says so (honest partial note) instead of rendering a short series as complete.
- `1h`/`24h` expose gaps honest data forces: recent rows carry no `cwd` (projects) and fold
  provider from the pricing catalog, both stated in-page.

## 15. Session traces delivered

Answers open question 5 and reverses the §7 deferral.

**Why the deferral was wrong.** The transcripts do carry span timing. Every message row has a
timestamp, assistants carry `completedAt` (and `ttft`, `stopReason`, usage), omp emits
`tool_execution_start` with its own `startedAt`, and `toolResult` rows close the call. pi writes no
`completedAt`, so its model spans end at the row's write time. Nothing is invented; an open tool
call ends at the last recorded activity and is marked `unterminated`.

**Backend.**

- `extensions/shared/session-trace.ts`: one track per transcript file — the main session plus each
  subagent file under the sibling `<session-stem>/<task name>.jsonl` directory. Span kinds: `turn`,
  `model`, `tool`, `subagent`, `background` (a `task` call), plus `model_change`/`mode_change`/
  `session_exit` markers. Summary: `wallMs` (first turn to last activity), `modelMs`, `toolMs`,
  `idleMs`, `turns`, `requests`, `toolCalls`, `subagents`, `totalTokens`, `costTotal`,
  `unpricedRequests`, per-tool stats.
- Three server routes in `cli/dashboard.ts`: `GET /sessions` (mtime-keyed parse cache),
  `GET /session/trace?file=` (ETag revalidation, mtime covers the main file and children), and
  `GET /session/entry?file=&id=` (raw transcript row for the drawer). `file` must resolve inside a
  real sessions root or the request is a 400.
- Verified on live data on both hosts: an omp session with 3 tracks (main + `scout` + `task`
  subagents), a pi session with 1743 spans, 82–940 KB payloads in ~25 ms, 304 on revalidation.

**Frontend.** The placeholder Traces page is gone. The page is a searchable sessions list
(`?session=` deep-linkable) and, per session, a summary strip, an SVG waterfall with one lane per
track (clickable spans, subagent jump, marker foot row), a span drawer that shows the span fields
plus the raw transcript entry, and the tool-stat table. The `range` picker does not apply — each
session is self-contained — and the page says so.

**Honest limit found in production.** `modelMs` is summed across tracks, so once subagent tracks
overlap the main track the sum can exceed `wallMs`. The summary strip labels this instead of
claiming a percentage that would be wrong.

**Tests.** `test/shared/session-trace.test.ts` (parser: omp rows, pi fallbacks, unterminated calls,
child-track linking, pricing, directory shape) plus `dashboard/app/test/traces.test.tsx` (list,
waterfall, drawer, error/empty states, route round-trip).

## 16. OMP-vs-tersio gap list

The audit this plan grew from. "OMP" rows are what the local omp-stats instance actually serves —
endpoints were enumerated live against `127.0.0.1:3847` — and every tersio row names where the
parity now lives.

### 16.1 Delivered

| OMP feature | Tersio | Where |
|---|---|---|
| Overview totals, error rate, cache rate, savings, coverage | Overview strip | §13 |
| `avgDuration`, `avgTtft` (range-aware) | "Avg elapsed" + "TTFT" strip stats from recent rows' `d`/`tf`, `N/A` when absent | §16 |
| Overview time series per metric | Chart mode control: Tokens / Requests / Errors / Cost; short ranges keep bucketed tables | §16 |
| Recent rows carry per-row `ttft` | `tf` on recent rows, fed by the `messages.ttft` column — spread serialization, no parser bump | §16 |
| Median (p50) latency | "Median elapsed" strip on Requests, even-count mean of middles | §16 |
| Error signatures | Errors "Failure groups": note → HTTP code → status, sorted, top 10 | §13 |
| `/api/sessions`, `/api/session/trace`, `/api/session/entry` | Same three routes; sessions list + waterfall + entry drawer | §15 |
| `/api/stats/recent` + request detail | `recent` 2000-row window + `RequestDrawer` | §13 |
| `/api/stats/folders` (projects) | Projects page from `byDayProject`; honest empty on short ranges | §13, §14 |
| `/api/stats/providers` | Providers page; in-page note that the label is the catalog-folded model provider | §13 |
| Models, Costs, Tools, Gain, Frustration (measured subset) | One page each | §13 |
| Range shortcuts | Six ranges + hotkeys `1`–`6` | §14 |

### 16.2 Not adopted, with reasons

| OMP feature | Why tersio does not ship it |
|---|---|
| `avgTokensPerSecond` | Needs per-request generation timing; dividing tokens by elapsed wall clock would conflate tool time with model speed. |
| `/api/stats/provider-windows` (rate-limit windows) | Needs account counts and cycle data tersio never records. Rendering zeros would fake parity. |
| `/api/events` (SSE live stream) | Non-goal §8: tersio polls every 5 s instead. |
| Frustration LLM judging | §7 deferral stands: only the measured interruption/recovery subset ships. |

### 16.3 Still open

Open questions 1–2 (port and `--port`/link behavior) and 4 (projects identity on short ranges,
§14 note). Question 3 and 5 are answered by §14 and §15.

## 17. Providers page rebuilt

Matches the OMP providers page at `127.0.0.1:3847/#/providers?range=24h`. Three new helpers in
`aggregate.ts`: `providerStats`, `providerSeries`, `providerHourHistogram`, all resolving a model
to its provider through one rule — the pricing catalog's entry, `unknown` when it names none —
so this page and every other page agree.

**Where each number comes from.** Tokens, requests, failures, models, and cost read the payload's
per-model tables, so a day range uses its exact stored days. Only duration lives on a single row, so
tokens per second is a mean over the rows that recorded one; hour of day is stored nowhere, so the
histogram folds the newest 2000 recent rows and says so on every range.

**What does not exist.** Subscription windows and window utilization are visible notes, not empty
tables. Each needs an account's plan, quota, reset, and rate-limit data, and the transcripts carry
none of it.

**Fixed on the way:** `windowPartial` counted any full recent list as a truncated window, so the
default 24h range showed a false "lower bound" note on five pages. A window is truncated only when
the list is full and every row in it falls inside the window.



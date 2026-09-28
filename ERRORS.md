# ERRORS.md

Recurring mistakes log. Committed to git; reviewed periodically to promote entries into permanent rules in `AGENTS.md` or linter config.

## Format

```md
## YYYY-MM-DD — <short title>
**What happened:** Describe the mistake or unexpected behavior.
**Root cause:** Why it happened.
**Prevention rule:** What to do differently next time.
```

## 2026-09-23 — Malformed oldString/newString boundary in edit calls
**What happened:** `edit` calls produced broken intermediates: a stray `async function` declaration line, a dropped `const SOURCES` opener, duplicated function headers, and deleted neighbors in dashboard/app.js. Each was caught by reading the edited region right after and repaired before building.
**Root cause:** Drafting replacement text that overlapped neighboring declarations instead of keeping the boundary to the exact lines being changed.
**Prevention rule:** Keep every edit boundary to the smallest requested change; read the edited region immediately after each structural edit and repair before moving on. Prefer python-script replacement for large JS block swaps.

## 2026-09-24 — Pixel harness measured live data and live animations, not the conversion
**What happened:** 16-region byte comparison showed 11–16/16 differing after a correct conversion. Three harness flaws stacked: exports embedded the live usage ledger (drifted between runs), addInitScript crashed on missing document.head so CSS animations kept running (ticker/donut positions shifted), and the model-row selector still targeted the deleted `.mrow` class.
**Root cause:** Verified against moving targets. Assumed frozen Date + animations-off without checking the init script survived page load; assumed exports were deterministic while the ledger appends every session turn.
**Prevention rule:** Freeze data first (snapshot DB via TERSIO_USAGE_DB, assert identical token totals in both exports), harden init scripts (guard document.head, MutationObserver re-apply), and re-run same-file double capture to prove 0/16 noise floor before comparing conversions. Disable recharts JS entrance animation (isAnimationActive={false}) — CSS kill-switches cannot stop it.

## 2026-09-29 — Unpriced model assumed unknown instead of aliased
**What happened:** The Dashboard showed `Space-Bunny` at $246.52 beside `stealth/Space-Bunny-Alpha` at $0.00. The first id matched no feed key, so it fell to the Sonnet-class default with `known:false` and reported a cost that was never charged.
**Root cause:** Read "no feed match" as "unpriced model" without checking for another spelling of the same model. The feed carries it as `openrouter/stealth/space-bunny-alpha`, priced at zero, and the plain alias missed it because the lookup only tried exact keys before the default.
**Prevention rule:** When a model lands on the default price, search the feed for suffixed, prefixed, and provider-spelled ids before concluding it is unpriced. Treat stealth and alias spellings as one model: group them under one key and resolve its price through the same exact-then-suffix chain, so a free model never reports a default. `MODEL_ALIASES` in `extensions/shared/pricing.ts` is where a new one goes.

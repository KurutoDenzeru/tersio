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

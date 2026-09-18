# ERRORS.md

Mistakes and corrections captured as they happen. Reviewed periodically to
promote entries into permanent rules in `AGENTS.md` or the linter config.
Entries are in the order they occurred; newest entries go at the bottom.

---

## 2026-09-18 — an additive edit silently deleted `refreshPricesIfStale()`

**What happened:** While adding an `RTK_COMMAND_ROWS` constant above
`summarizeUsage()` in `cli/usage.ts`, an `edit_file` call removed the
`refreshPricesIfStale();` call that opened the function body. The edit was
intended to be purely additive. It was caught in the same turn when the
returned snippet showed the body one line shorter, and restored immediately,
so nothing shipped.

**Root cause:** `old_string` spanned two lines (the function signature plus the
call beneath it) while `new_string` reproduced only the signature. Ending
`old_string` on a line that `new_string` does not reproduce deletes that line,
so an additive intent produced a subtler subtractive edit. The tool reported
success either way.

**Prevention rule:** Never end `old_string` on a line that must survive.
Anchor on text that appears verbatim in both `old_string` and `new_string`.
After every `edit_file`, read the returned snippet and confirm the line count
changed by exactly the amount intended.

---

## 2026-09-18 — same slip dropped `const prev = process.env.TERSIO_PRICES_FILE;`

**What happened:** Inserting a new test before the `usdCost flags unpriced
models` test in `test/usage-tokens.test.ts` dropped that test's opening
`const prev = process.env.TERSIO_PRICES_FILE;` line. Had it gone unnoticed, the
`finally` block would have restored `undefined` instead of the caller's value
and leaked `TERSIO_PRICES_FILE` into the rest of the suite. Caught immediately
and restored in the next edit.

**Root cause:** Identical to the entry above — `old_string` ended on a line that
`new_string` did not repeat, so the replacement consumed the anchor line.

**Prevention rule:** Same as above. This is the second occurrence in a single
session, so treat "does `new_string` reproduce every line of `old_string`?"
as a mandatory check before sending an `edit_file` call rather than something
to catch from the returned snippet afterwards.

// The update surface's decision rules: when a cadence is due, when a release is offered, and what
// the operator's choices do to the next offer.
import { expect, test } from "vitest";
import { dueIn, isDue, newerAvailable, setUpdatePrefs, shouldPrompt, updateView } from "../../cli/dashboard-update.ts";
import type { UpdateView } from "../../cli/dashboard-update.ts";
import { patchState } from "../../extensions/shared/state.ts";
import { withHome } from "../helpers/env.ts";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

/** One view with every field named, so a new field cannot slip into the tests unset. */
function viewOf(overrides: Partial<Omit<UpdateView, "prompt">> = {}): Omit<UpdateView, "prompt"> {
  return {
    current: "1.0.0",
    running: "1.0.0",
    latest: "1.0.1",
    source: "npm",
    npmLatest: "1.0.1",
    available: true,
    schedule: "daily",
    auto: false,
    lastCheck: NOW,
    dueIn: DAY,
    snoozeIn: null,
    skipped: null,
    status: "idle",
    log: [],
    error: null,
    ...overrides,
  };
}

test("a cadence waits its window, and a due check never reports a negative wait", () => {
  expect(dueIn(null, "off", NOW)).toBe(null);
  expect(dueIn(NOW - DAY + 60_000, "daily", NOW)).toBe(60_000);
  expect(dueIn(NOW - DAY, "daily", NOW)).toBe(0);
  expect(dueIn(NOW - DAY * 3, "daily", NOW)).toBe(0);
  expect(dueIn(NOW, "weekly", NOW)).toBe(7 * DAY);
  expect(dueIn(NOW, "monthly", NOW)).toBe(30 * DAY);
  // A first run has no stamp, so the cadence counts from the epoch and is due at once.
  expect(dueIn(undefined, "daily", NOW)).toBe(0);
});

test("a due check reads the stamp, and a nonsense stamp asks rather than waits", () => {
  expect(isDue(NOW - DAY, "daily", NOW)).toBe(true);
  expect(isDue(NOW - DAY + 1, "daily", NOW)).toBe(false);
  expect(isDue(NOW, "daily", NOW)).toBe(false);
  expect(isDue(NOW + DAY, "daily", NOW)).toBe(false);
  expect(isDue(null, "daily", NOW)).toBe(true);
  expect(isDue(undefined, "daily", NOW)).toBe(true);
  expect(isDue(Number.NaN, "daily", NOW)).toBe(true);
  expect(isDue("1792343914880", "daily", NOW)).toBe(true);
  expect(isDue(NOW - DAY * 365, "off", NOW)).toBe(false);
});

test("a release counts as newer only when it is newer than this build and not skipped", () => {
  expect(newerAvailable("1.0.0", "1.0.1", null)).toBe(true);
  expect(newerAvailable("1.0.0", "1.0.0", null)).toBe(false);
  expect(newerAvailable("2.0.0", "1.9.9", null)).toBe(false);
  expect(newerAvailable("1.0.0", "1.0.1", "1.0.1")).toBe(false);
  expect(newerAvailable("1.0.0", null, null)).toBe(false);
  // Two segments still compare: 1.2 is older than 1.2.1.
  expect(newerAvailable("1.2", "1.2.1", null)).toBe(true);
});

test("the prompt needs an available release, an idle server, and no live reminder", () => {
  expect(shouldPrompt(viewOf())).toBe(true);
  expect(shouldPrompt(viewOf({ snoozeIn: 1 }))).toBe(false);
  expect(shouldPrompt(viewOf({ status: "applying" }))).toBe(false);
  expect(shouldPrompt(viewOf({ status: "checking" }))).toBe(false);
  expect(shouldPrompt(viewOf({ available: false }))).toBe(false);
});

test("a schedule choice round-trips, and a level outside the set leaves the stored one alone", () => {
  withHome(() => {
    expect(updateView().schedule).toBe("daily");
    expect(setUpdatePrefs({ schedule: "monthly" }).schedule).toBe("monthly");
    expect(setUpdatePrefs({ schedule: "hourly" as never }).schedule).toBe("monthly");
  });
});

test("a skipped release stops asking, and the next one asks again", () => {
  withHome(() => {
    patchState({ updateCheck: { latest: "99.0.0", lastCheck: Date.now() } });
    expect(updateView().available).toBe(true);
    expect(updateView().prompt).toBe(true);

    expect(setUpdatePrefs({ action: "skip", version: "99.0.0" }).available).toBe(false);
    expect(updateView().prompt).toBe(false);

    patchState({ updateCheck: { latest: "99.0.1", lastCheck: Date.now() } });
    expect(updateView().prompt).toBe(true);
  });
});

test("the view names the source of the release and the registry's own tag", () => {
  withHome(() => {
    patchState({ updateCheck: { latest: "99.0.0", source: "github", npm: "2.25.9", lastCheck: Date.now() } });
    const view = updateView();
    expect(view.latest).toBe("99.0.0");
    expect(view.source).toBe("github");
    expect(view.npmLatest).toBe("2.25.9");
  });
});

test("a reminder hides the prompt for its window, then lets it through", () => {
  withHome(() => {
    patchState({ updateCheck: { latest: "99.0.0", lastCheck: Date.now() } });
    const snoozed = setUpdatePrefs({ action: "snooze" });
    expect(snoozed.available).toBe(true);
    expect(snoozed.prompt).toBe(false);
    expect(snoozed.snoozeIn).toBeGreaterThan(0);

    // Rewriting the stamp into the past is the same as waiting the window out.
    patchState({ updateSnoozeUntil: Date.now() - 1 });
    expect(updateView().prompt).toBe(true);
    expect(updateView().snoozeIn).toBe(null);

    // Clearing it early works too, which is what picking an update does.
    setUpdatePrefs({ action: "snooze" });
    expect(updateView().prompt).toBe(false);
    expect(setUpdatePrefs({ action: "now" }).prompt).toBe(true);
  });
});

// One poll of the server's update view, shared by the prompt toast and the About pane.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUpdate, postUpdateApply, postUpdateCheck, postUpdatePrefs } from "./data";
import type { UpdateSchedule, UpdateView } from "./data";
import { useActionToast, useDismissToast, useToast } from "@/components/toaster";

/** How often the page asks at rest, and how quickly it follows a first read or work in flight. */
const POLL_MS = 20_000;
const QUICK_MS = 1_200;

export interface UpdateFeed {
  view: UpdateView | null;
  check: () => void;
  apply: () => void;
  snooze: () => void;
  skip: () => void;
  setSchedule: (schedule: UpdateSchedule) => void;
}

/** Read, act, and prompt from one place: the toast and the About pane cannot disagree. */
export function useUpdate(): UpdateFeed {
  const [view, setView] = useState<UpdateView | null>(null);
  const push = useToast();
  const pushAction = useActionToast();
  const dismiss = useDismissToast();
  // Actions need the newest view without re-creating their callbacks on every poll.
  const latest = useRef<UpdateView | null>(null);
  // Only entering `applying` raises the progress notice, so hiding it sticks for that run.
  const lastStatus = useRef<string | null>(null);

  const adopt = useCallback((next: UpdateView | null) => {
    if (!next) return;
    latest.current = next;
    setView(next);
  }, []);

  const check = useCallback(() => { void postUpdateCheck().then(adopt); }, [adopt]);
  const apply = useCallback(() => { void postUpdateApply().then(adopt); }, [adopt]);
  const setSchedule = useCallback((schedule: UpdateSchedule) => {
    void postUpdatePrefs({ schedule }).then(adopt);
  }, [adopt]);
  const snooze = useCallback(() => {
    void postUpdatePrefs({ action: "snooze" }).then((next) => {
      adopt(next);
      push("Reminder set", "Tersio asks again in six hours.", "clock");
    });
  }, [adopt, push]);
  const skip = useCallback(() => {
    const version = latest.current?.latest;
    if (!version) return;
    void postUpdatePrefs({ action: "skip", version }).then((next) => {
      adopt(next);
      push(`Skipped ${version}`, "The next release asks again.", "circle-slash");
    });
  }, [adopt, push]);

  // One read per period, re-armed on every view. An action that flips the status therefore pulls the next read forward, instead of the page waiting out a rest cadence armed before the action.
  useEffect(() => {
    let alive = true;
    const period = view === null || view.status !== "idle" ? QUICK_MS : POLL_MS;
    const timer = window.setTimeout(() => {
      void fetchUpdate().then((next) => {
        if (alive) adopt(next);
      });
    }, period);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [view, adopt]);

  // A backgrounded tab throttles timers, so catching up on sight beats waiting one out.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void fetchUpdate().then(adopt);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [adopt]);

  useEffect(() => {
    if (!view) return;
    const was = lastStatus.current;
    lastStatus.current = view.status;

    if (view.status === "applying") {
      if (was !== "applying") {
        dismiss("update-available");
        pushAction({
          id: "update-progress",
          title: "Updating Tersio",
          desc: "Fetching the release and refreshing the add-ons.",
          icon: "download",
          actions: [{ label: "Hide", variant: "outline", onClick: () => undefined }],
        });
      }
      return;
    }

    if (was === "applying") {
      dismiss("update-progress");
      if (view.error) {
        push("Update failed", view.error, "circle-alert");
      } else if (view.current !== view.running) {
        push(`Tersio ${view.current} installed`, "Reload to run the new build.", "check");
      } else {
        push("Tersio is up to date", `${view.current} is the newest release.`, "check");
      }
    }

    if (view.prompt && view.latest) {
      pushAction({
        id: "update-available",
        title: `Tersio ${view.latest} is available`,
        desc: `You run ${view.current}.`,
        icon: "download",
        actions: [
          { label: "Update now", variant: "primary", onClick: apply },
          { label: "Remind me later", onClick: snooze },
          { label: "Skip this version", onClick: skip },
        ],
      });
    } else {
      dismiss("update-available");
    }
  }, [view, apply, snooze, skip, dismiss, push, pushAction]);

  return { view, check, apply, snooze, skip, setSchedule };
}
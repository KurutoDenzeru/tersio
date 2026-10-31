// The developer toggle behind Settings > About. It gates the surfaces an operator never needs. The server owns the value, in ~/.tersio/settings.
import { useSyncExternalStore } from "react";
import { isFileExport } from "./data";

const STORAGE_KEY = "tersio-dev";

const listeners = new Set<() => void>();
let current = false;
let hydrated = false;
/** Bumped on every local flip, so a slow hydrate answer never clobbers a newer toggle. */
let localWrites = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!hydrated) hydrate();
  // A second tab that flips the toggle carries no local event, so the storage event relays it.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): boolean {
  return current;
}

/** Read the saved value once: the server when there is one, else the browser store. */
function hydrate(): void {
  hydrated = true;
  // A flip that lands while this read is in flight is newer than the answer: the ticket only lets the response apply when nothing was set locally since the read started, or the toggle would snap back.
  const ticket = localWrites;
  if (isFileExport() || typeof fetch !== "function") {
    current = localStorage.getItem(STORAGE_KEY) === "1";
    emit();
    return;
  }
  fetch("/settings")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { devTools?: unknown } | null) => {
      if (ticket !== localWrites) return;
      if (typeof data?.devTools === "boolean") {
        current = data.devTools;
        emit();
      }
    })
    .catch(() => { /* keep the default; the switch still saves */ });
}

export function setDevMode(on: boolean): void {
  localWrites += 1;
  current = on;
  emit();
  // The browser copy is the export fallback, and it makes the next paint correct before the round trip.
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  if (isFileExport() || typeof fetch !== "function") return;
  void fetch("/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devTools: on }),
  }).catch(() => { /* the switch stays on screen; the next load reports the truth */ });
}

export function useDevMode(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
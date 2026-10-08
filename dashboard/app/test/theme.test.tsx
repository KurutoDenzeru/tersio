// @vitest-environment happy-dom
// Dark mode reaches two independent token blocks: shadcn's, which keys on the `dark` class, and
// Tersio's own, which keys on html[data-theme="dark"] with a prefers-color-scheme fallback when
// data-theme is absent (system mode). Only the class half is easy to break silently, so it is pinned.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { ThemeProvider } from "../src/components/theme-provider";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
});

function renderWith(theme: string): void {
  localStorage.setItem("tersio-theme", theme);
  render(
    <ThemeProvider storageKey="tersio-theme">
      <div />
    </ThemeProvider>,
  );
}

test("a dark theme adds the dark class that shadcn tokens key on", async () => {
  renderWith("dark");
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
});

test("a light theme swaps dark for light", async () => {
  renderWith("light");
  await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

// System mode resolves through matchMedia, so the class must follow the OS, not the stored word.
test("system theme resolves to a concrete class rather than none", async () => {
  renderWith("system");
  await waitFor(() => {
    const cls = document.documentElement.classList;
    expect(cls.contains("dark") || cls.contains("light")).toBe(true);
  });
});

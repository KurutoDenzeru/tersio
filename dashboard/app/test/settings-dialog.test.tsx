// @vitest-environment happy-dom
// The settings dialog composes seven panes that now live in their own modules. This pins that the
// split left the wiring intact: each pane still mounts inside its tab, through the real imports.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SettingsDialog } from "../src/components/dialogs";
import { ThemeProvider } from "../src/components/theme-provider";
import { ToasterProvider } from "../src/components/toaster";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The panes fetch on mount; every answer is an empty ok so each one settles.
function renderDialog(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
  render(
    <ToasterProvider>
      <ThemeProvider storageKey="tersio-theme">
        <SettingsDialog
          open
          onClose={() => undefined}
          data={null}
          cur="USD"
          onCurrency={() => undefined}
          onReload={() => undefined}
        />
      </ThemeProvider>
    </ToasterProvider>,
  );
}

function openPane(name: RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

test("the general pane renders its extracted default-modes and accent-picker modules", async () => {
  renderDialog();
  expect(await screen.findByText("Modes")).toBeTruthy();
  expect(screen.getByText("Combo preset")).toBeTruthy();
  // AccentPicker lives in its own file and renders one labelled chip per accent.
  expect(screen.getByRole("radio", { name: /Emerald/i })).toBeTruthy();
});

test("the connection pane mounts the extracted agent rows", async () => {
  renderDialog();
  openPane(/^Connection$/);
  expect(await screen.findByText("Coding agents")).toBeTruthy();
  expect(screen.getByText("Oh My Pi")).toBeTruthy();
});

test("the data pane mounts the extracted snapshot list", async () => {
  renderDialog();
  openPane(/^Data$/);
  expect(await screen.findByText("Backups")).toBeTruthy();
  expect(screen.getByText("Danger zone")).toBeTruthy();
});

test("the diagnosis pane mounts the extracted check table", async () => {
  renderDialog();
  openPane(/^Diagnosis$/);
  expect(await screen.findByText("Auto-check")).toBeTruthy();
  // "Fix issues" is both the row heading and the button label, so target the button itself.
  expect(screen.getByRole("button", { name: "Fix diagnosed issues" })).toBeTruthy();
});

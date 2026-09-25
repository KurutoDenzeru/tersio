#!/usr/bin/env node
// tersio.ts — Install Tersio (caveman/rtk/ponytail) add-ons on any OMP device.
// Usage: node tersio.js [install|update|reinstall|doctor|dashboard|uninstall|version|help] [options]
// Requires: node/npm and omp CLI
import {
  PACKAGE_BIN, PACKAGE_VERSION, applyUpdate, commandArg, dashboard, dashboardExport, dashboardOpen, dashboardPort, doctor, reset, settings, showHelp, showVersion, uninstall, unknownCommand, update, usage,
} from './cli/common.ts';
import { closeRL } from './cli/interactive.ts';
import { runInstall } from './cli/install.ts';
import { runDoctor } from './cli/doctor.ts';
import { runLatestUpdate } from './cli/update.ts';
import { runUninstall } from './cli/uninstall.ts';
import { runUsage } from './cli/usage.ts';
import { runReset } from './cli/reset.ts';
import { runSettings } from './cli/settings.ts';
import { runDashboard } from './cli/dashboard.ts';

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_BIN} [command] [options]

Commands:
  install      Install the add-ons (user scope: all OMP sessions)
  update       Refresh the CLI and add-ons (RTK binary, Caveman rule, Ponytail)
  reinstall    Clean and reinstall the user-scope add-ons
  doctor       Check the current installation (--fix repairs, --dry-run previews)
  usage        Ledger-backed usage + savings report
  dashboard     Open the Dashboard (localhost only)
  reset        Clear tersio statistics (usage ledger)
  settings     View/change session-start defaults (combo, caveman, rtk, ponytail)
  uninstall    Remove the managed extensions
  version      Print the package version
  help         Show this help

Options:
  --fix (doctor: repairs all; --fix=<scope> repairs one of extensions, registrations, rtk, ponytail, cli)
  --scope user (legacy; accepted and ignored — user scope is the only scope)
  --keep-ponytail (uninstall: keep the bundled Ponytail copy — removed by default)
  --remove-rtk (uninstall: also remove the RTK binary)
  --combo-default off|medium|balanced|max (implies caveman, rtk, ponytail)
  --caveman-default off|lite|full|ultra|wenyan (override; default follows combo)
  --ponytail-default off|lite|full|ultra|review (override; default follows combo)
  --rtk-default on|off (override; default follows combo)
  --yes, -y
  --dry-run
  --verbose
  --port <n> (dashboard: pin port, default ephemeral)
  --open (dashboard: open browser)
  --export <file> (dashboard: write HTML file instead of serving)
  --currency <code> (usage|dashboard: display currency; flag wins, then tersio settings default, then USD)
  --version, -v
  --help, -h`);
}

async function main(): Promise<void> {
  if (showVersion) {
    console.log(PACKAGE_VERSION);
    closeRL();
    return;
  }

  if (showHelp) {
    printHelp();
    closeRL();
    return;
  }

  if (unknownCommand) {
    console.error(`Unknown command: ${commandArg}`);
    printHelp();
    process.exitCode = 1;
    closeRL();
    return;
  }

  if (update && !applyUpdate) {
    await runLatestUpdate();
    closeRL();
    return;
  }

  if (doctor) {
    await runDoctor();
    closeRL();
    return;
  }

  if (usage) {
    await runUsage();
    closeRL();
    return;
  }

  if (dashboard) {
    await runDashboard({ port: dashboardPort, open: dashboardOpen, exportFile: dashboardExport });
    closeRL();
    return;
  }

  if (reset) {
    await runReset();
    closeRL();
    return;
  }

  if (settings) {
    await runSettings();
    return;
  }

  if (uninstall) {
    await runUninstall();
    closeRL();
    return;
  }
  await runInstall();
}

main().catch((e) => { closeRL(); console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
// tersio.ts — Install Tersio (caveman/rtk/ponytail) into the coding agents on this machine.
// Usage: node tersio.js [install|update|reinstall|doctor|dashboard|uninstall|version|help] [options]
// Requires: node/npm, and at least one supported agent
import {
  PACKAGE_BIN, PACKAGE_VERSION, applyUpdate, commandArg, dashboard, dashboardExport, dashboardOpen, dashboardPort, doctor, reset, settings, showHelp, showVersion, uninstall, unknownCommand, update, usage,
} from './cli/common.ts';
import { HOSTS } from './cli/agent-hosts.ts';
import { closeRL } from './cli/interactive.ts';
import { runInstall } from './cli/install.ts';
import { runDoctor } from './cli/doctor.ts';
import { runLatestUpdate } from './cli/update.ts';
import { runUninstall } from './cli/uninstall.ts';
import { runUsage } from './cli/usage.ts';
import { runReset } from './cli/reset.ts';
import { runSettings } from './cli/settings.ts';
import { runDashboard } from './cli/dashboard.ts';

/**
 * The `--agent` id list, derived from the registry and wrapped for the help
 * column. Hard-coding it meant dropping a host left a stale id advertised here.
 */
function agentIdHelp(): string {
  const ids = HOSTS.map((h) => h.id);
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const chunk = ids.slice(i, i + 6).join(', ');
    const last = i + 6 >= ids.length;
    out.push(`                   ${out.length === 0 ? 'Known ids: ' : ''}${chunk}${last ? '.' : ','}`);
  }
  return out.join('\n');
}

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
  --agent <ids>    Target coding agents for the generic rules/skills/hook install.
                   Repeatable and comma-separated.
${agentIdHelp()}
                   Saved to ~/.tersio/agents.json and reused by later runs.
  --fix (doctor: repairs all; --fix=<scope> repairs one of extensions, registrations, rtk, ponytail, cli, hosts)
  --scope user (legacy; accepted and ignored — user scope is the only scope)
  --keep-ponytail (uninstall: keep the bundled Ponytail copy — removed by default)
  --remove-rtk (uninstall: also remove the RTK binary)
  --combo-default off|medium|balanced|max (implies caveman, rtk, ponytail)
  --caveman-default off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra (override; default follows combo)
  --ponytail-default off|lite|full|ultra (override; default follows combo)
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

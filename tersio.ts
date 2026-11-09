#!/usr/bin/env node
// Install Tersio add-ons on any OMP device; see help for commands.
import {
  PACKAGE_BIN, PACKAGE_VERSION, applyUpdate, codexHook, commandArg, dashboard, dashboardBind, dashboardExport, dashboardOpen, dashboardPort, dashboardWatch, doctor, mcp, modes, showHelp, showVersion, uninstall, unknownCommand, update, upstream,
  currency,
} from './cli/common.ts';
import { closeRL } from './cli/interactive.ts';
import { preferBun } from './cli/runtime.ts';
// Each command loads its own module: the installer never pays for the dashboard tree, and a version check never pays for the installer. The imports stay static here so a missing file fails loudly.

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_BIN} [command] [options]

Commands:
  install      Install the add-ons for one agent (--host omp|pi|opencode|pig|dsh|codex, or ask at a terminal)
  update       Refresh the CLI and add-ons (RTK binary, Caveman rule, Ponytail; --host limits to one agent)
  doctor       Check the current installation (--fix repairs, --dry-run previews)
  dashboard     Open the Dashboard (every interface, so a phone can reach it)
  mcp           Start the Tersio MCP server on stdio, for any MCP client
  modes         Read or set session defaults, scoped with --host
  uninstall    Remove the managed extensions
  version      Print the package version
  help         Show this help

Options:
  --fix (doctor: repairs all; --fix=<scope> repairs one of extensions, registrations, rtk, ponytail, cli, service)
  --scope user (legacy; accepted and ignored — user scope is the only scope)
  --host omp|pi|opencode|pig|dsh|codex (install|uninstall|update: target agent; a terminal asks instead)
  --keep-ponytail (uninstall: keep the bundled Ponytail copy — removed by default)
  --remove-rtk (uninstall: also remove the RTK binary; its OMP wiring always goes)
  --combo-default off|lite|balanced|max (implies caveman, rtk, ponytail)
  --caveman-default off|lite|full|ultra|megacave-lite|megacave-full|megacave-ultra (override; default follows combo)
  --ponytail-default off|lite|full|ultra (override; default follows combo)
  --rtk-default on|off (override; default follows combo)
  --yes, -y
  --dry-run
  --verbose
  --port <n> (dashboard: pin port, default ephemeral)
  --open (dashboard: open browser)
  --local (dashboard: listen on loopback only)
  --watch (dashboard: restart on source change and rebuild the UI on save; automatic in a source checkout)
  --bind <addr> (dashboard: listen address; default every interface, so a phone can open it)
  --export <file> (dashboard: write HTML file instead of serving)
  --currency <code> (dashboard: display currency; flag wins, then tersio settings default, then USD)
  --version, -v
  --help, -h

Environment:
  TERSIO_RUNTIME=node (stay on node; the CLI uses bun when it is installed)`);
}

async function main(): Promise<void> {
  // Every command, not just the server: bun boots faster than the node the shebang names.
  await preferBun(process.argv.slice(2));

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

  if (codexHook) {
    const { runCodexHook } = await import('./cli/codex-hook.ts');
    await runCodexHook(process.argv[3]);
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
    const { runLatestUpdate } = await import('./cli/update.ts');
    await runLatestUpdate();
    closeRL();
    return;
  }

  if (mcp) {
    const { runMcpServer } = await import('./cli/mcp.ts');
    await runMcpServer();
    closeRL();
    return;
  }

  if (modes) {
    const { runModes } = await import('./cli/modes.ts');
    await runModes(process.argv.slice(3));
    closeRL();
    return;
  }

  if (doctor) {
    const { runDoctor } = await import('./cli/doctor.ts');
    await runDoctor();
    closeRL();
    return;
  }

  if (upstream) {
    const { runUpstream } = await import('./cli/upstream.ts');
    await runUpstream();
    closeRL();
    return;
  }

  if (dashboard) {
    const { runDashboard } = await import('./cli/dashboard.ts');
    await runDashboard({ port: dashboardPort, bind: dashboardBind, watch: dashboardWatch, open: dashboardOpen, exportFile: dashboardExport, currency });
    closeRL();
    return;
  }

  if (uninstall) {
    const { runUninstall } = await import('./cli/uninstall.ts');
    await runUninstall();
    closeRL();
    return;
  }
  const { runInstall } = await import('./cli/install.ts');
  await runInstall();
}

main().catch((e) => { closeRL(); console.error(e); process.exitCode = 1; });

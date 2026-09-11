#!/usr/bin/env node
// tersio.ts — Install Tersio (caveman/rtk/ponytail) add-ons on any OMP device.
// Usage: node tersio.js [install|update|reinstall|doctor|uninstall|version|help] [options]
// Requires: node/npm and omp CLI
import {
  PACKAGE_BIN, PACKAGE_VERSION, applyUpdate, commandArg, doctor, showHelp, showVersion, uninstall, unknownCommand, update,
} from './cli/common.ts';
import { closeRL } from './cli/interactive.ts';
import { runInstall } from './cli/install.ts';
import { runDoctor } from './cli/doctor.ts';
import { runLatestUpdate } from './cli/update.ts';
import { runUninstall } from './cli/uninstall.ts';

function printHelp(): void {
  console.log(`Usage: ${PACKAGE_BIN} [command] [options]

Commands:
  install      Install the add-ons (user scope by default)
  update       Refresh the CLI and add-ons (RTK binary, Caveman rule, Ponytail)
  reinstall    Clean and reinstall the user-scope add-ons
  doctor       Check the current installation
  uninstall    Remove the managed extensions
  version      Print the package version
  help         Show this help

Options:
  --scope user|project|both
  --keep-ponytail (uninstall: keep the Ponytail plugin — removed by default)
  --remove-rtk (uninstall: also remove the RTK binary)
  --combo-default off|medium|balanced|max (implies caveman, rtk, ponytail)
  --caveman-default off|lite|full|ultra|wenyan (override; default follows combo)
  --ponytail-default off|lite|full|ultra|review (override; default follows combo)
  --rtk-default on|off (override; default follows combo)
  --yes, -y
  --dry-run
  --verbose
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

  if (uninstall) {
    await runUninstall();
    closeRL();
    return;
  }
  await runInstall();
}

main().catch((e) => { closeRL(); console.error(e); process.exitCode = 1; });

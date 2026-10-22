// Set pi paths deliberately via cliEnv(); a temp HOME once deleted a real tree.
delete process.env.PI_CODING_AGENT;
delete process.env.PI_CODING_AGENT_DIR;

// A caller's own Tersio environment must not decide where this suite reads and writes: the agentic benchmark runs inherited TERSIO_HOME from the harness, which sent the usage store, the prices feed, and the doctor paths outside the temp home each test builds, and RTK_DISABLED=1 made two wired-hook tests fail on their own. Each test that needs an override sets it itself.
for (const name of [
  "TERSIO_HOME",
  "TERSIO_USAGE_DB",
  "TERSIO_USAGE_FILE",
  "TERSIO_RESET_FILE",
  "TERSIO_SESSIONS_DIR",
  "TERSIO_OPENCODE_DIR",
  "TERSIO_OPENCODE_DB",
  "TERSIO_AGENT_STATS_DB",
  "TERSIO_AGENT_SESSIONS_DB",
  "TERSIO_RTK_DB",
  "TERSIO_PRICES_FILE",
  "TERSIO_PRICES_OVERRIDE_FILE",
  "TERSIO_PRICES_URL",
  "TERSIO_UPDATE_URL",
  "TERSIO_RELEASES_URL",
  "TERSIO_SQLITE",
  "TERSIO_FORCE_REPARSE",
  "RTK_DISABLED",
] as const) {
  delete process.env[name];
}

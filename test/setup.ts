// Runs before every test file. A session that runs the suite inside pi exports
// PI_CODING_AGENT and PI_CODING_AGENT_DIR, and the host honours the directory
// override only when the marker is present. So a test that moves process.env.HOME
// to a temp dir would still read and write the developer's real ~/.pi/agent —
// which is how an `uninstall --host pi` test deleted a real pi extension tree.
//
// Clearing both here makes ~/.pi/agent resolve from HOME, so the temp HOME is
// the whole sandbox. Tests that assert pi-path behaviour set them deliberately
// through cliEnv() in ./helpers/env.ts.
delete process.env.PI_CODING_AGENT;
delete process.env.PI_CODING_AGENT_DIR;

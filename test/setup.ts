// Set pi paths deliberately via cliEnv(); a temp HOME once deleted a real tree.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

delete process.env.PI_CODING_AGENT;
delete process.env.PI_CODING_AGENT_DIR;

// Sandbox Tersio's own data dir. Without it a test that syncs the usage mirror writes the
// developer's real ~/.tersio/usage.db, and a parser-version bump there drops every row whose
// transcript has rotated away. TERSIO_HOME, not HOME: redirecting HOME would also move Python's
// user site-packages and silently skip the pyte-backed terminal tests.
// Tests that need their own data dir override it through cliEnv() or withEnv().
process.env.TERSIO_HOME = mkdtempSync(path.join(os.tmpdir(), "tersio-test-home-"));

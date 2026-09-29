// The environment for a spawned CLI. A test moves HOME to a temp dir, and pi's
// agent dir has to move with it: the host honours PI_CODING_AGENT_DIR only when
// PI_CODING_AGENT is set, and a session running the suite inside pi exports
// both. Without this, a spawn with a temp HOME still reads and writes the
// developer's real ~/.pi/agent — which is how one `uninstall --host pi` test
// deleted a real pi extension tree.
import path from 'node:path';

export function cliEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT: 'true',
    PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
    ...extra,
  };
}

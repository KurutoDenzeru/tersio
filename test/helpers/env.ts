// Pins the pi agent vars alongside a temp HOME, so a spawned CLI cannot write
// the developer's real ~/.pi/agent — once deleted a real extension tree.
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

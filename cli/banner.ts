// cli/banner.ts — mini pixel-scissor welcome (16x10 px -> 5 half-block rows).
// OMP-style launch moment for interactive runs: clack intro + note box.
// TTY-only and skipped on --dry-run, so piped output stays byte-identical.
import { intro as clackIntro, note as clackNote } from '@clack/prompts';
import { PACKAGE_VERSION, dryRun } from './common.ts';

function tty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Pixel classes: B/b blades, P pivot, L/R handle rings, l shafts.
const GRID = [
  '..BB........bb..',
  '..BBB......bbb..',
  '....BB....bb....',
  '.....BBBbbb.....',
  '......BPPb......',
  '....L.lPPl..R...',
  '..LLLLLl.lRRRRR.',
  '..LL.LL...RR.RR.',
  '.LL...LL.RR...RR',
  '..LL.LL...RR.RR.',
];

// [truecolor rgb, ansi256] per class. Left ring red, right ring yellow.
const PALETTE: Record<string, [string, string]> = {
  B: ['190;200;210', '252'],
  b: ['190;200;210', '252'],
  P: ['212;175;55', '172'],
  L: ['239;68;68', '196'],
  R: ['250;204;21', '220'],
  l: ['190;200;210', '252'],
};

type Tier = 'true' | '256' | 'plain';

function bannerTier(): Tier {
  if (process.env.NO_COLOR !== undefined) return 'plain';
  if (/truecolor|24bit/i.test(process.env.COLORTERM ?? '')) return 'true';
  if (/256color/i.test(process.env.TERM ?? '')) return '256';
  return 'plain';
}

function paint(ka: string | null, kb: string | null, tier: Tier): string {
  if (!ka && !kb) return ' ';
  if (tier === 'plain') {
    if (ka && kb) return '█';
    return ka ? '▀' : '▄';
  }
  const fg = (k: string): string => (tier === 'true' ? `\x1b[38;2;${PALETTE[k][0]}m` : `\x1b[38;5;${PALETTE[k][1]}m`);
  const bg = (k: string): string => (tier === 'true' ? `\x1b[48;2;${PALETTE[k][0]}m` : `\x1b[48;5;${PALETTE[k][1]}m`);
  if (ka && kb && ka === kb) return `${fg(ka)}█\x1b[0m`;
  if (ka && kb) return `${fg(ka)}${bg(kb)}▀\x1b[0m`;
  if (ka) return `${fg(ka)}▀\x1b[0m`;
  return `${fg(kb as string)}▄\x1b[0m`;
}

// Five 16-wide rows. Pure: unit-testable without a TTY.
function bannerLines(tier: Tier = bannerTier()): string[] {
  const out: string[] = [];
  for (let r = 0; r < GRID.length; r += 2) {
    let line = '';
    for (let x = 0; x < GRID[r].length; x++) {
      const ka = GRID[r][x] === '.' ? null : GRID[r][x];
      const kb = GRID[r + 1][x] === '.' ? null : GRID[r + 1][x];
      line += paint(ka, kb, tier);
    }
    out.push(line);
  }
  return out;
}

let shown = false;

// OMP-style welcome: intro line + note box with art and tips.
// No-op unless interactive (and never on --dry-run).
function printWelcome(): void {
  if (shown || dryRun || !tty()) return;
  shown = true;
  clackIntro(`✂ tersio v${PACKAGE_VERSION}`);
  clackNote(
    `${bannerLines().join('\n')}\n\n  /tersio combo medium   toggle all three\n  /tersio caveman full    terse replies\n  /tersio rtk on          compact shell output`,
    'cut token bloat',
  );
}

export { bannerLines, bannerTier, printWelcome };
export type { Tier };

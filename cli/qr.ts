// A minimal QR encoder for the LAN address the dashboard prints. Byte mode, error correction M,
// versions 1-6, mask 0. Enough for a short URL; anything longer returns null and prints no code.
//
// The spec pieces are here because no dependency ships a QR encoder: data codewords, Reed-Solomon
// blocks, function patterns, format bits, and the zigzag placement the scanner expects.

interface VersionSpec {
  /** Data codewords per block. */
  data: number;
  /** Error-correction codewords per block. */
  ec: number;
  /** How many blocks the data splits into. */
  blocks: number;
}

// EC level M block structure, versions 1-6. The last entry holds a 106-byte URL.
const VERSIONS: VersionSpec[] = [
  { data: 16, ec: 10, blocks: 1 },
  { data: 28, ec: 16, blocks: 1 },
  { data: 44, ec: 26, blocks: 1 },
  { data: 32, ec: 18, blocks: 2 },
  { data: 43, ec: 24, blocks: 2 },
  { data: 27, ec: 16, blocks: 4 },
];

// Alignment-pattern centers per version, version 1 having none.
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function polyMul(a: number[], b: number[]): number[] {
  const out = Array.from({ length: a.length + b.length - 1 }, () => 0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] ^= gfMul(a[i], b[j]);
  }
  return out;
}

function withFixedBits(out: number[], value: number, width: number): void {
  for (let i = width - 1; i >= 0; i -= 1) out.push((value >> i) & 1);
}

function dataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const total = spec.data * spec.blocks;
  const bits: number[] = [];
  withFixedBits(bits, 0b0100, 4);
  withFixedBits(bits, bytes.length, 8);
  for (const byte of bytes) withFixedBits(bits, byte, 8);
  for (let i = 0; i < 4 && bits.length < total * 8; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out = new Uint8Array(total);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out[i / 8] = byte;
  }
  for (let i = bits.length / 8, pad = 0; i < total; i += 1, pad += 1) out[i] = pad % 2 === 0 ? 0xec : 0x11;
  return out;
}

function errorCodewords(block: Uint8Array, degree: number): Uint8Array {
  let generator = [1];
  for (let i = 0; i < degree; i += 1) generator = polyMul(generator, [1, EXP[i]]);
  const work = new Uint8Array(block.length + degree);
  work.set(block);
  for (let i = 0; i < block.length; i += 1) {
    const factor = work[i];
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j += 1) work[i + j] ^= gfMul(generator[j], factor);
  }
  return work.slice(block.length);
}

function interleave(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let i = 0; i < spec.blocks; i += 1) {
    const block = data.slice(i * spec.data, (i + 1) * spec.data);
    dataBlocks.push(block);
    ecBlocks.push(errorCodewords(block, spec.ec));
  }
  const out = new Uint8Array((spec.data + spec.ec) * spec.blocks);
  let at = 0;
  for (let i = 0; i < spec.data; i += 1) {
    for (const block of dataBlocks) out[at++] = block[i];
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of ecBlocks) out[at++] = block[i];
  }
  return out;
}

function drawFinder(matrix: boolean[][], reserved: boolean[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[y][x] = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (edge || core);
      reserved[y][x] = true;
    }
  }
}

function drawFormat(matrix: boolean[][], reserved: boolean[][], size: number): void {
  // Format bits for EC level M and mask 0, with the 15-bit BCH remainder and its fixed XOR mask.
  const data = 0;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) if (((remainder >> i) & 1) !== 0) remainder ^= 0x537 << (i - 10);
  const bits = ((data << 10) | (remainder & 0x3ff)) ^ 0x5412;
  const set = (row: number, col: number, bit: number): void => {
    matrix[row][col] = ((bits >> bit) & 1) === 1;
    reserved[row][col] = true;
  };
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) set(i, 8, i);
    else if (i === 6) set(7, 8, i);
    else if (i === 7) set(8, 8, i);
    else if (i === 8) set(8, 7, i);
    else set(8, 14 - i, i);
    if (i < 8) set(8, size - 1 - i, i);
    else set(size - 15 + i, 8, i);
  }
  // The single dark module every symbol carries at column 8, above the bottom-left finder.
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;
}

/** The module grid for a byte-mode symbol, or null when the text needs a version past 6. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const versionIndex = VERSIONS.findIndex((spec) => spec.data * spec.blocks - 2 >= bytes.length);
  if (versionIndex < 0) return null;
  const spec = VERSIONS[versionIndex];
  const version = versionIndex + 1;
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false));

  drawFinder(matrix, reserved, 0, 0);
  drawFinder(matrix, reserved, 0, size - 7);
  drawFinder(matrix, reserved, size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }
  const centers = ALIGNMENT[versionIndex];
  for (const row of centers) {
    for (const col of centers) {
      if (reserved[row][col]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          matrix[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) === 2 || (r === 0 && c === 0);
          reserved[row + r][col + c] = true;
        }
      }
    }
  }
  drawFormat(matrix, reserved, size);

  const codewords = interleave(dataCodewords(bytes, spec), spec);
  const totalBits = codewords.length * 8;
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        const dark = bit < totalBits && ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        bit += 1;
        // Mask 0: every module whose row and column share parity flips.
        matrix[row][col] = dark !== ((row + col) % 2 === 0);
      }
    }
    upward = !upward;
  }
  return matrix;
}

/** A compact, theme-independent QR for a terminal: black modules on white, two rows per character. */
export function qrTerminal(text: string): string | null {
  const matrix = qrMatrix(text);
  if (matrix === null) return null;
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const at = (row: number, col: number): boolean => {
    const y = row - quiet;
    const x = col - quiet;
    return y >= 0 && x >= 0 && y < matrix.length && x < matrix.length && matrix[y][x];
  };
  const lines: string[] = [];
  for (let row = 0; row < size; row += 2) {
    let line = '\x1b[30;47m';
    for (let col = 0; col < size; col += 1) {
      const top = at(row, col);
      const bottom = row + 1 < size && at(row + 1, col);
      line += top ? (bottom ? '\u2588' : '\u2580') : (bottom ? '\u2584' : ' ');
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}

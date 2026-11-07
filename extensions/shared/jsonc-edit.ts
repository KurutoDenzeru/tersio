// Comment-preserving edits for a `.jsonc` file. A JSON.parse round-trip flattens every comment and
// every trailing comma, so one key is spliced in place instead, and a shape the scanner cannot follow
// returns null rather than writing something worse.

/** The end of a JSON string that starts at `start`, or -1 when it never closes. */
function skipString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

/** The index just past the comment that starts at `start`, or -1 for an unterminated block. */
function skipComment(text: string, start: number): number {
  if (text[start + 1] === '/') {
    const nl = text.indexOf('\n', start);
    return nl < 0 ? text.length : nl + 1;
  }
  const end = text.indexOf('*/', start + 2);
  return end < 0 ? -1 : end + 2;
}

/** Where a top-level key sits and where its value begins, scanning past strings and comments. */
export function findTopLevelKey(text: string, key: string): { keyStart: number; valueStart: number } | null {
  return findKeyWithin(text, 0, text.length, key, 1);
}

/** The same scan for one object's own keys, which sit at `depth` from the root. */
function findKeyWithin(text: string, from: number, to: number, key: string, depth = 1): { keyStart: number; valueStart: number } | null {
  let level = depth - 1;
  for (let i = from; i < to;) {
    const char = text[i]!;
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      if (i < 0) return null;
      continue;
    }
    if (char === '"') {
      const end = skipString(text, i);
      if (end < 0) return null;
      if (level === 1 && text.slice(i + 1, end - 1) === key) {
        let at = end;
        while (at < to && /\s/.test(text[at]!)) at++;
        if (text[at] === ':') {
          at++;
          while (at < to && /\s/.test(text[at]!)) at++;
          return { keyStart: i, valueStart: at };
        }
      }
      i = end;
      continue;
    }
    if (char === '{' || char === '[') level++;
    else if (char === '}' || char === ']') level--;
    i++;
  }
  return null;
}

/** The index where the value starting at `start` ends, so a replacement can replace exactly it. */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length;) {
    const char = text[i]!;
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      if (i < 0) return -1;
      continue;
    }
    if (char === '"') {
      const end = skipString(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === '{' || char === '[') { depth++; i++; continue; }
    if (char === '}' || char === ']') {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    if (char === ',' && depth === 0) return i;
    i++;
  }
  return -1;
}

/** Everything from the value's end to `end`, keeping a comment that sat beside the old value. */
function keepComment(text: string, valueStart: number, end: number): string {
  const at = trailingComment(text, valueStart, end);
  return at < 0 ? text.slice(end) : ` ${text.slice(at)}`;
}

/** The index of a trailing comment inside a value's span, or -1 when there is none to keep. */
function trailingComment(text: string, from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to;) {
    const char = text[i]!;
    if (char === '"') {
      const end = skipString(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      if (depth === 0) return i;
      const end = skipComment(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    i++;
  }
  return -1;
}

/** The indentation of the line the key starts on, so a rewritten value keeps its column. */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  return /^\s*/.exec(text.slice(lineStart, index))?.[0] ?? '';
}

function indentBody(text: string, keyIndex: number, body: string): string {
  const pad = indentAt(text, keyIndex);
  return body.split('\n').map((line, n) => (n === 0 ? line : pad + line)).join('\n');
}

/** Cuts one key and its value, taking the comma that separated it so no stray `,` is left behind. */
function removeKey(text: string, found: { keyStart: number; valueStart: number }): string | null {
  const end = valueEnd(text, found.valueStart);
  if (end < 0) return null;
  let before = found.keyStart - 1;
  while (before >= 0 && /\s/.test(text[before]!)) before--;
  if (text[before] === ',') return text.slice(0, before) + text.slice(end);
  let after = end;
  while (after < text.length && /\s/.test(text[after]!)) after++;
  return text.slice(0, found.keyStart) + text.slice(text[after] === ',' ? after + 1 : end);
}

/**
 * Rewrites one top-level key in place, so a `.jsonc` keeps its comments and layout that a
 * JSON.parse round-trip would drop. Null means the text could not be scanned and nothing was written.
 */
export function spliceTopLevelKey(text: string, key: string, value: unknown): string | null {
  const found = findTopLevelKey(text, key);
  if (found) {
    const end = valueEnd(text, found.valueStart);
    if (end < 0) return null;
    return `${text.slice(0, found.valueStart)}${indentBody(text, found.keyStart, JSON.stringify(value, null, 2))}${text.slice(end)}`;
  }
  // No key yet: insert it right after the root brace, where a comment above the first property
  // can never end up between the brace and the comma.
  let open = 0;
  while (open < text.length && text[open] !== '{') {
    if (text[open] === '/' && (text[open + 1] === '/' || text[open + 1] === '*')) {
      open = skipComment(text, open);
      if (open < 0) return null;
      continue;
    }
    open++;
  }
  if (open >= text.length) return null;
  let after = open + 1;
  while (after < text.length && /\s/.test(text[after]!)) after++;
  let empty = text[after] === '}';
  if (!empty && text[after] === '/' && (text[after + 1] === '/' || text[after + 1] === '*')) {
    const jump = skipComment(text, after);
    if (jump < 0) return null;
    let probe = jump;
    while (probe < text.length && /\s/.test(text[probe]!)) probe++;
    empty = text[probe] === '}';
  }
  const block = `${JSON.stringify(key)}: ${indentBody(text, open, JSON.stringify(value, null, 2)).replace(/^/, '')}`;
  return `${text.slice(0, open + 1)}\n  ${block}${empty ? '' : ','}${text.slice(open + 1)}`;
}

/**
 * Adds, replaces, or removes one entry inside an object key, touching nothing else in the file.
 * A null value removes the entry; a missing entry is not an error, so a re-run stays quiet.
 */
export function spliceNestedKey(text: string, outer: string, inner: string, value: unknown): string | null {
  const container = findTopLevelKey(text, outer);
  if (!container) return null;
  if (text[container.valueStart] !== '{') return null;
  const containerEnd = valueEnd(text, container.valueStart);
  if (containerEnd < 0) return null;
  const found = findKeyWithin(text, container.valueStart + 1, containerEnd, inner, 2);
  if (value === null) return found ? removeKey(text, found) : text;
  const body = JSON.stringify(value, null, 2);
  if (found) {
    const end = valueEnd(text, found.valueStart);
    if (end < 0) return null;
    return `${text.slice(0, found.valueStart)}${indentBody(text, found.keyStart, body)}${keepComment(text, found.valueStart, end)}`;
  }
  const pad = `${indentAt(text, container.keyStart)}  `;
  let inner_end = containerEnd - 1;
  while (inner_end > container.valueStart && /\s/.test(text[inner_end]!)) inner_end--;
  const empty = text[inner_end] === '{';
  const block = `${JSON.stringify(inner)}: ${body.split('\n').map((line, n) => (n === 0 ? line : pad + line)).join('\n')}`;
  return `${text.slice(0, container.valueStart + 1)}\n${pad}${block}${empty ? '' : ','}${text.slice(container.valueStart + 1)}`;
}

/**
 * Replace the value at a dotted path that already exists, leaving everything else in the file alone.
 * Null means a level was missing or the shape could not be followed, so nothing is written.
 */
export function splicePath(text: string, keys: string[], value: unknown): string | null {
  if (keys.length === 0) return null;
  const top = findTopLevelKey(text, keys[0]!);
  if (!top) return null;
  let target = top;
  for (const key of keys.slice(1)) {
    if (text[target.valueStart] !== '{') return null;
    const containerEnd = valueEnd(text, target.valueStart);
    if (containerEnd < 0) return null;
    const next = findKeyWithin(text, target.valueStart + 1, containerEnd, key, 2);
    if (!next) return null;
    target = next;
  }
  const end = valueEnd(text, target.valueStart);
  if (end < 0) return null;
  return `${text.slice(0, target.valueStart)}${indentBody(text, target.keyStart, JSON.stringify(value, null, 2))}${keepComment(text, target.valueStart, end)}`;
}

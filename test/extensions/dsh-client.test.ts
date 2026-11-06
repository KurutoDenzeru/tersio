import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test } from 'vitest';

// The loader injects this bundle as a classic script, so every evaluation shares the page's global
// scope. Built by `bun run build`, like the other tests that read dist.
const BUNDLE = path.join(process.cwd(), 'dist', 'extensions', 'dsh', 'client.js');

test('the client bundle registers through the loader and leaks no globals', () => {
  const ids: string[] = [];
  const context = vm.createContext({
    __ModuleLoader__: { load: (spec: { id: string }) => { ids.push(spec.id); } },
    console,
  });
  const code = readFileSync(BUNDLE, 'utf8');
  vm.runInContext(code, context, { filename: 'client.js' });
  expect(ids).toEqual(['@krtclcdy/tersio']);
  // A reload re-executes the bundle in the same scope; a top-level const would throw right here.
  vm.runInContext(code, context, { filename: 'client.js' });
  expect(ids).toEqual(['@krtclcdy/tersio', '@krtclcdy/tersio']);
  // The guard names the page's own name for the facade, and nothing else escapes the file.
  expect(vm.runInContext('typeof loader', context)).toBe('undefined');
  expect(vm.runInContext('typeof STYLES', context)).toBe('undefined');
});

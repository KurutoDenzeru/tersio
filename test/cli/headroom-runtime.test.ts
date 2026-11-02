import http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { headroomHostSupported } from '../../extensions/shared/headroom-proxy.ts';
import { headroomRuntimeUp } from '../../cli/headroom-runtime.ts';

describe('headroom runtime', () => {
  const before = process.env.TERSIO_HEADROOM_PROXY_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
    else process.env.TERSIO_HEADROOM_PROXY_URL = before;
  });

  test('only Oh My Pi and OpenCode are routed hosts', () => {
    expect(headroomHostSupported('omp')).toBe(true);
    expect(headroomHostSupported('opencode')).toBe(true);
    expect(headroomHostSupported('pi')).toBe(false);
    expect(headroomHostSupported('pig')).toBe(false);
    expect(headroomHostSupported('dsh')).toBe(false);
  });

  test('a live /readyz reads as up, and a closed port reads as down', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/readyz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ready":true}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
    expect(await headroomRuntimeUp()).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await headroomRuntimeUp()).toBe(false);
  });
});

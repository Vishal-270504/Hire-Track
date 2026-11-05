import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './helpers.js';

/**
 * Fails when a registered API route has no test that calls it.
 * A test counts when it calls  client.<method>('<url>')  with the route's path,
 * where each :param matches one URL segment (so /api/x/:id does not match /api/x/1/y).
 */
const here = dirname(fileURLToPath(import.meta.url));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function routePattern(url) {
  return url
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/\'"`]*' : escape(seg)))
    .join('/');
}

const testSource = readdirSync(here)
  .filter((f) => f.endsWith('.test.js') && f !== 'coverage.test.js')
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n');

describe('API coverage', () => {
  it('every registered route is called by at least one test', async () => {
    const h = await harness();
    const missing = [];
    for (const { method, url } of h.app.routes) {
      const m = method.toLowerCase();
      const re = new RegExp(`\\.${m}\\(\\s*[\`'"]${routePattern(url)}(?=[?'\`"])`);
      if (!re.test(testSource)) missing.push(`${method} ${url}`);
    }
    expect(missing, `Routes with no test:\n${missing.join('\n')}`).toEqual([]);
  });

  it('finds at least the routes we know exist (guards against an empty route list)', async () => {
    const h = await harness();
    const urls = h.app.routes.map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual(expect.arrayContaining(['GET /api/health', 'POST /api/auth/login', 'PATCH /api/users/:id']));
  });
});

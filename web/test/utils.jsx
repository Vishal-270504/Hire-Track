import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from '../src/App.jsx';

export const USERS = {
  HR: { id: 1, name: 'Priya Raman', email: 'hr@x.test', role: 'HR', permissions: ['candidate.read', 'settings.write', 'salary.read'] },
  ADMIN: { id: 2, name: 'Rohan Shah', email: 'admin@x.test', role: 'ADMIN', permissions: ['users.manage', 'settings.read', 'settings.write'] },
};

/**
 * Replaces fetch with a router of canned responses.
 * routes: { 'GET /api/auth/me': () => [status, body], ... }
 * Unmatched calls answer 404 so a missing mock is visible in the test output.
 */
export function mockApi(routes) {
  const calls = [];
  const fn = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    const handler = routes[key];
    const [status, body] = handler ? handler(opts.body ? JSON.parse(opts.body) : undefined) : [404, { error: `no mock for ${key}`, code: 'not_found', fields: {} }];
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

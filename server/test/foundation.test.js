import { describe, it, expect } from 'vitest';
import { openDb, helpers } from '../src/db/index.js';
import { migrations } from '../src/db/migrations.js';
import { policy, savePolicy, resetPolicy, allPolicy } from '../src/policy/index.js';
import { DEFAULTS } from '../src/policy/defaults.js';
import { AppError, rule, notFound, forbidden, stale } from '../src/errors.js';
import { seedIfEmpty } from '../src/seed/run.js';
import { harness } from './helpers.js';

describe('database migrations', () => {
  it('applies every migration and records the version', () => {
    const db = openDb(':memory:');
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(migrations.length);
  });

  it('creates the foundation tables and rejects unknown roles', () => {
    const db = openDb(':memory:');
    const tables = helpers(db).all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['settings', 'users', 'audit_log', 'sessions']));
    expect(() =>
      helpers(db).run("INSERT INTO users (name,email,password_hash,role,created_at) VALUES ('x','a@b.c','h','JANITOR','t')"),
    ).toThrow();
  });
});

describe('policy defaults (PDF values)', () => {
  it('returns the PDF numbers when nothing is customised', async () => {
    const { db } = await harness();
    expect(policy(db, 'ats.shortlistAt')).toBe(75);
    expect(policy(db, 'ats.reviewAt')).toBe(50);
    expect(policy(db, 'ats.weights.mustHave')).toBe(40);
    expect(policy(db, 'interviews.rescheduleLimit')).toBe(2);
    expect(policy(db, 'probation.confirmAt')).toBe(3.0);
    expect(policy(db, 'probation.pipAt')).toBe(2.5);
    expect(policy(db, 'reapplyCoolingDays')).toBe(180);
  });

  it('ATS and probation weights each add up to 100', () => {
    expect(Object.values(DEFAULTS.ats.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(DEFAULTS.probation.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it('a saved block overrides defaults, and reset restores them', async () => {
    const { db } = await harness();
    savePolicy(db, 'ats', { ...DEFAULTS.ats, shortlistAt: 80 }, '2026-11-05T00:00:00Z');
    expect(policy(db, 'ats.shortlistAt')).toBe(80);
    expect(allPolicy(db).customised).toContain('ats');
    resetPolicy(db, 'ats');
    expect(policy(db, 'ats.shortlistAt')).toBe(75);
    expect(allPolicy(db).customised).not.toContain('ats');
  });
});

describe('errors', () => {
  it('carry the status and code the UI needs', () => {
    const e = rule('Round 2 has no feedback yet.');
    expect(e).toBeInstanceOf(AppError);
    expect([e.status, e.code]).toEqual([422, 'rule_blocked']);
    expect(notFound('Candidate').status).toBe(404);
    expect(forbidden().status).toBe(403);
    expect(stale().status).toBe(409);
  });
});

describe('app shell', () => {
  it('health endpoint responds using the injected clock', async () => {
    const h = await harness();
    const res = await h.anon.get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, at: '2026-11-05T09:00:00.000Z' });
  });

  it('turns AppError into the {error, code, fields} shape', async () => {
    const h = await harness();
    h.app.get('/api/test-boom', async () => { throw rule('Fix this first.'); });
    const res = await h.anon.get('/api/test-boom');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Fix this first.', code: 'rule_blocked', fields: {} });
  });

  it('hides internal errors behind a plain message', async () => {
    const h = await harness();
    h.app.get('/api/test-crash', async () => { throw new Error('secret stack detail'); });
    const res = await h.anon.get('/api/test-crash');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret stack detail');
    expect(res.json().code).toBe('server_error');
  });

  it('seed creates one demo account per role on an empty database only', () => {
    const db = openDb(':memory:');
    expect(seedIfEmpty(db, { demo: true })).toBe(true);
    expect(helpers(db).one('SELECT COUNT(*) AS n FROM users').n).toBe(5);
    expect(seedIfEmpty(db, { demo: true })).toBe(false);
  });
});

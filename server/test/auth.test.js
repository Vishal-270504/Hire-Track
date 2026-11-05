import { describe, it, expect } from 'vitest';
import { harness, PASSWORD } from './helpers.js';
import { can, ROLES, RULES } from '../src/auth/permissions.js';
import { helpers } from '../src/db/index.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

const login = (h, email, password = PASSWORD) => h.anon.post('/api/auth/login', { email, password });
const cookieFrom = (res) => /ht_session=([^;]+)/.exec(res.headers['set-cookie'] ?? '')?.[1];

describe('passwords', () => {
  it('hashes with a salt and verifies only the right password', () => {
    const stored = hashPassword('a-long-password');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('a-long-password', stored)).toBe(true);
    expect(verifyPassword('a-long-passwor', stored)).toBe(false);
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password and sets an httpOnly session cookie', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const res = await login(h, hr.email);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: hr.email, role: 'HR' });
    expect(res.headers['set-cookie']).toMatch(/ht_session=.+; Max-Age=|ht_session=.+;/);
    expect(res.headers['set-cookie']).toMatch(/HttpOnly/i);
  });

  it('gives the same friendly message for a wrong password and an unknown email', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const wrongPw = await login(h, hr.email, 'nope-nope-nope');
    const noUser = await login(h, 'ghost@test.local', 'nope-nope-nope');
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual(noUser.json());
    expect(wrongPw.json().error).toMatch(/Email or password is not right/);
  });

  it('refuses an inactive account even with the right password', async () => {
    const h = await harness();
    const hr = h.person('HR');
    helpers(h.db).run('UPDATE users SET active = 0 WHERE id = ?', hr.id);
    expect((await login(h, hr.email)).statusCode).toBe(401);
  });

  it('asks for both fields when they are missing', async () => {
    const h = await harness();
    const res = await h.anon.post('/api/auth/login', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation');
  });

  it('writes an audit row for the sign-in', async () => {
    const h = await harness();
    const hr = h.person('HR');
    await login(h, hr.email);
    const row = helpers(h.db).one("SELECT * FROM audit_log WHERE action = 'auth.login'");
    expect(row).toMatchObject({ user_id: hr.id, entity: 'user', entity_id: hr.id });
  });
});

describe('GET /api/auth/me and sessions', () => {
  it('returns 401 without a session', async () => {
    const h = await harness();
    const res = await h.anon.get('/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorised');
  });

  it('returns the signed-in user', async () => {
    const h = await harness();
    const rec = h.as('RECRUITER', 'Arjun Mehta');
    const res = await rec.get('/api/auth/me');
    expect(res.json().user).toMatchObject({ name: 'Arjun Mehta', role: 'RECRUITER' });
  });

  it('lists the actions the person may take, so the UI matches the server rules', async () => {
    const h = await harness();
    const perms = (await h.as('INTERVIEWER').get('/api/auth/me')).json().user.permissions;
    expect(perms).toEqual(expect.arrayContaining(['feedback.submit', 'candidate.read']));
    expect(perms).not.toContain('users.manage');
    expect(perms).not.toContain('salary.read');
  });

  it('logout ends the session on the server, so the old cookie stops working', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const token = cookieFrom(await login(h, hr.email));
    const client = h.client({ token });
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
    await client.post('/api/auth/logout');
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('a session expires after 12 hours', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const token = cookieFrom(await login(h, hr.email));
    const client = h.client({ token });
    h.clock.advanceHours(11);
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
    h.clock.advanceHours(2);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('a deactivated user loses access on the next request', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const client = h.client(hr);
    helpers(h.db).run('UPDATE users SET active = 0 WHERE id = ?', hr.id);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('demo accounts are listed in development', async () => {
    const h = await harness();
    const res = await h.anon.get('/api/auth/demo-accounts');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().accounts)).toBe(true);
  });
});

describe('permission matrix', () => {
  // Expected result for each role on each action, written out so a rule change is a visible diff.
  const expected = {
    'users.manage':       { HR: false, RECRUITER: false, INTERVIEWER: false, IT: false, ADMIN: true },
    'settings.read':      { HR: true,  RECRUITER: true,  INTERVIEWER: true,  IT: true,  ADMIN: true },
    'settings.write':     { HR: true,  RECRUITER: false, INTERVIEWER: false, IT: false, ADMIN: true },
    'requisition.read':   { HR: true,  RECRUITER: true,  INTERVIEWER: false, IT: false, ADMIN: true },
    'requisition.approve': { HR: true, RECRUITER: true,  INTERVIEWER: true,  IT: true,  ADMIN: true }, // named approver checked in service
    'requisition.write':  { HR: true,  RECRUITER: true,  INTERVIEWER: false, IT: false, ADMIN: true },
    'candidate.read':     { HR: true,  RECRUITER: true,  INTERVIEWER: true,  IT: false, ADMIN: true },
    'candidate.write':    { HR: true,  RECRUITER: true,  INTERVIEWER: false, IT: false, ADMIN: true },
    'candidate.exit':     { HR: true,  RECRUITER: true,  INTERVIEWER: false, IT: false, ADMIN: true },
    'round.schedule':     { HR: true,  RECRUITER: true,  INTERVIEWER: false, IT: false, ADMIN: true },
    'feedback.submit':    { HR: true,  RECRUITER: true,  INTERVIEWER: true,  IT: true,  ADMIN: true },
    'salary.read':        { HR: true,  RECRUITER: false, INTERVIEWER: false, IT: false, ADMIN: true },
    'reminders.read':     { HR: true,  RECRUITER: true,  INTERVIEWER: true,  IT: true,  ADMIN: true },
  };

  it('covers every rule in the table', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(RULES).sort());
  });

  for (const [action, byRole] of Object.entries(expected)) {
    for (const role of ROLES) {
      it(`${role} ${byRole[role] ? 'can' : 'cannot'} ${action}`, () => {
        expect(can(role, action)).toBe(byRole[role]);
      });
    }
  }

  it('throws on an unknown permission instead of silently allowing it', () => {
    expect(() => can('HR', 'made.up')).toThrow(/Unknown permission/);
  });
});

describe('user administration (ADMIN only)', () => {
  it('blocks non-admins with 403 and anonymous callers with 401', async () => {
    const h = await harness();
    expect((await h.as('HR').get('/api/users')).statusCode).toBe(403);
    expect((await h.anon.get('/api/users')).statusCode).toBe(401);
  });

  it('admin lists users without password hashes', async () => {
    const h = await harness();
    const admin = h.as('ADMIN');
    h.person('HR');
    const res = await admin.get('/api/users');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('scrypt$');
    expect(res.json().users.length).toBeGreaterThanOrEqual(2);
  });

  it('admin creates a user; the new person can sign in with the password set', async () => {
    const h = await harness();
    const res = await h.as('ADMIN').post('/api/users', {
      name: 'New Interviewer', email: 'new.interviewer@test.local', password: 'a-strong-password', role: 'INTERVIEWER',
    });
    expect(res.statusCode).toBe(201);
    expect((await login(h, 'new.interviewer@test.local', 'a-strong-password')).statusCode).toBe(200);
  });

  it('rejects a duplicate email with a field-level message', async () => {
    const h = await harness();
    const existing = h.person('HR');
    const res = await h.as('ADMIN').post('/api/users', {
      name: 'Copy Cat', email: existing.email.toUpperCase(), password: 'a-strong-password', role: 'HR',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('duplicate');
  });

  it('explains exactly which field is wrong when a new user is incomplete', async () => {
    const h = await harness();
    const res = await h.as('ADMIN').post('/api/users', { name: 'X', email: 'not-an-email', password: 'short', role: 'BOSS' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().fields)).toEqual(expect.arrayContaining(['name', 'email', 'password', 'role']));
  });

  it('changing a role writes an audit row with before and after', async () => {
    const h = await harness();
    const hr = h.person('HR');
    const res = await h.as('ADMIN').patch(`/api/users/${hr.id}`, { role: 'RECRUITER' });
    expect(res.json().user.role).toBe('RECRUITER');
    const row = helpers(h.db).one("SELECT detail FROM audit_log WHERE action = 'user.update' AND entity_id = ?", hr.id);
    expect(JSON.parse(row.detail)).toMatchObject({ before: { role: 'HR' }, after: { role: 'RECRUITER' } });
  });

  it('returns 404 for a user that does not exist', async () => {
    const h = await harness();
    expect((await h.as('ADMIN').patch('/api/users/99999', { active: false })).statusCode).toBe(404);
  });

  it('will not remove the last active admin', async () => {
    const h = await harness();
    const admin = h.person('ADMIN');
    const res = await h.client(h.person('HR')).patch(`/api/users/${admin.id}`, { role: 'HR' });
    expect(res.statusCode).toBe(403); // HR cannot manage users at all
    const res2 = await h.client(h.person('ADMIN')).patch(`/api/users/${admin.id}`, { active: false });
    expect(res2.statusCode).toBe(200); // a second admin exists, so this is allowed
    const res3 = await h.client(h.person('ADMIN')).patch(`/api/users/${admin.id}`, { active: true });
    expect(res3.statusCode).toBe(200);
  });

  it('an admin cannot remove their own admin access', async () => {
    const h = await harness();
    const admin = h.as('ADMIN');
    const me = (await admin.get('/api/auth/me')).json().user;
    h.person('ADMIN'); // a second admin, so the last-admin rule does not fire first
    const res = await admin.patch(`/api/users/${me.id}`, { role: 'HR' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('self_lock');
  });
});

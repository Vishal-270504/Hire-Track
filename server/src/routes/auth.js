import { z } from 'zod';
import { COOKIE, needUser } from '../auth/guard.js';
import { createSession, endSession } from '../auth/session.js';
import { verifyPassword } from '../auth/passwords.js';
import { findUserByEmail, publicUser, findUserById } from '../db/repo/users.js';
import { hashPassword } from '../auth/passwords.js';
import { audit } from '../audit/index.js';
import { AppError } from '../errors.js';
import { helpers } from '../db/index.js';

import { RULES, can } from '../auth/permissions.js';

/** The signed-in person plus every action they may take, so the UI never guesses permissions. */
const sessionPayload = (user) => ({
  ...user,
  permissions: Object.keys(RULES).filter((action) => can(user.role, action)),
});

const LoginBody = z.object({
  email: z.string().trim().min(1, 'Enter the email you were given.'),
  password: z.string().min(1, 'Enter your password.'),
});

// One message for every login failure, so the form never reveals which emails exist.
const BAD_LOGIN = () => new AppError(401, 'bad_login', 'Email or password is not right. Check both and try again.');

export async function authRoutes(app) {
  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = LoginBody.parse(req.body ?? {});
    const row = findUserByEmail(app.db, email);
    if (!row || !row.active || !verifyPassword(password, row.password_hash)) throw BAD_LOGIN();

    const now = app.clock.now();
    const { token, expires } = createSession(app.db, row.id, now);
    audit(app.db, { at: now.toISOString(), userId: row.id, action: 'auth.login', entity: 'user', entityId: row.id });
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(expires),
    });
    return { user: sessionPayload(publicUser(row)) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) endSession(app.db, token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: sessionPayload(needUser(req)) }));

  // Change your own password. The current password must be given, and the other sessions end.
  app.post('/api/auth/password', async (req) => {
    const me = needUser(req);
    const body = z.object({
      current: z.string().min(1, 'Enter your current password.'),
      next: z.string().min(10, 'Use at least 10 characters.'),
    }).parse(req.body ?? {});
    const row = findUserById(app.db, me.id);
    if (!verifyPassword(body.current, row.password_hash)) {
      throw new AppError(422, 'wrong_password', 'Your current password is not right.', { current: 'Check your current password.' });
    }
    helpers(app.db).run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.next), me.id);
    helpers(app.db).run('DELETE FROM sessions WHERE user_id = ?', me.id);
    audit(app.db, { at: app.clock.now().toISOString(), userId: me.id, action: 'auth.password_change', entity: 'user', entityId: me.id });
    return { ok: true };
  });

  // Shown on the login page in development only, so testers can try each role.
  app.get('/api/auth/demo-accounts', async () => {
    if (process.env.NODE_ENV === 'production') return { accounts: [] };
    const rows = helpers(app.db).all(
      "SELECT name, email, role FROM users WHERE email LIKE '%@hiretrack.local' ORDER BY id",
    );
    return { accounts: rows };
  });
}

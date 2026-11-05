import { createHash, randomBytes } from 'node:crypto';
import { helpers } from '../db/index.js';

export const SESSION_HOURS = 12;

// Only a hash of the token is stored, so a leaked database cannot be used to sign in.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createSession(db, userId, now) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString();
  helpers(db).run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token), userId, now.toISOString(), expires,
  );
  return { token, expires };
}

export function sessionUser(db, token, now) {
  const row = helpers(db).one(
    `SELECT u.id, u.name, u.email, u.role, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    hashToken(token),
  );
  if (!row || !row.active || new Date(row.expires_at) <= now) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function endSession(db, token) {
  helpers(db).run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
}

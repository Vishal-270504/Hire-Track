import { helpers } from '../index.js';
import { hashPassword } from '../../auth/passwords.js';

export const publicUser = (r) => r && { id: r.id, name: r.name, email: r.email, role: r.role, active: !!r.active };

export function listUsers(db) {
  return helpers(db).all('SELECT * FROM users ORDER BY name').map(publicUser);
}

export function findUserById(db, id) {
  return helpers(db).one('SELECT * FROM users WHERE id = ?', id);
}

export function findUserByEmail(db, email) {
  return helpers(db).one('SELECT * FROM users WHERE email = ? COLLATE NOCASE', String(email).trim());
}

export function countActiveAdmins(db) {
  return helpers(db).one("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND active = 1").n;
}

export function createUser(db, { name, email, password, role }, now = new Date().toISOString()) {
  const info = helpers(db).run(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    name.trim(), email.trim().toLowerCase(), hashPassword(password), role, now,
  );
  return publicUser(findUserById(db, Number(info.lastInsertRowid)));
}

export function updateUser(db, id, patch) {
  const sets = [];
  const args = [];
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name.trim()); }
  if (patch.role !== undefined) { sets.push('role = ?'); args.push(patch.role); }
  if (patch.active !== undefined) { sets.push('active = ?'); args.push(patch.active ? 1 : 0); }
  if (sets.length) helpers(db).run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
  return publicUser(findUserById(db, id));
}

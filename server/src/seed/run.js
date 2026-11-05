import { pathToFileURL } from 'node:url';
import { openDb, helpers } from '../db/index.js';
import { createUser } from '../db/repo/users.js';

export const DEMO_PASSWORD = 'hiretrack-demo';

// One account per role, so every screen can be tried as each person.
export const DEMO_USERS = [
  { name: 'Priya Raman', email: 'hr@hiretrack.local', role: 'HR' },
  { name: 'Arjun Mehta', email: 'recruiter@hiretrack.local', role: 'RECRUITER' },
  { name: 'Sana Iqbal', email: 'interviewer@hiretrack.local', role: 'INTERVIEWER' },
  { name: 'Dev Kaur', email: 'it@hiretrack.local', role: 'IT' },
  { name: 'Rohan Shah', email: 'admin@hiretrack.local', role: 'ADMIN' },
];

/**
 * Runs only on an empty database, so it is safe to call on every start.
 * - Always: creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if both are set.
 * - demo=true: also creates one demo account per role.
 */
export function seedIfEmpty(db, { demo = false } = {}) {
  const { one } = helpers(db);
  if (one('SELECT COUNT(*) AS n FROM users').n > 0) return false;

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    createUser(db, { name: 'Administrator', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'ADMIN' });
  }
  if (demo) {
    for (const u of DEMO_USERS) createUser(db, { ...u, password: DEMO_PASSWORD });
  }
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedIfEmpty(openDb(process.env.DB_FILE ?? 'hiretrack.db'), { demo: process.env.NODE_ENV !== 'production' });
  console.log('Seed complete.');
}

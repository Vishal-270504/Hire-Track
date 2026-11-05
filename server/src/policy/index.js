import { DEFAULTS } from './defaults.js';
import { helpers } from '../db/index.js';

/**
 * Reads a policy value. Stored overrides (settings table) win over DEFAULTS.
 * Usage: policy(db, 'ats.shortlistAt') -> 75
 */
export function policy(db, path) {
  const { one } = helpers(db);
  const root = path.split('.')[0];
  const row = one('SELECT value FROM settings WHERE key = ?', root);
  const stored = row ? JSON.parse(row.value) : null;
  return get(stored ?? DEFAULTS[root], path.split('.').slice(1)) ?? get(DEFAULTS, path.split('.'));
}

function get(obj, parts) {
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Saves a whole top-level policy block (e.g. 'ats'). Validation lives in the route. */
export function savePolicy(db, block, value, now) {
  helpers(db).run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    block, JSON.stringify(value), now,
  );
}

/** Removes stored overrides so DEFAULTS apply again. */
export function resetPolicy(db, block) {
  helpers(db).run('DELETE FROM settings WHERE key = ?', block);
}

/** Everything as the UI needs it: defaults merged with overrides, plus which blocks are customised. */
export function allPolicy(db) {
  const { all } = helpers(db);
  const stored = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value)]));
  const values = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, stored[k] ?? DEFAULTS[k]]));
  return { values, customised: Object.keys(stored) };
}

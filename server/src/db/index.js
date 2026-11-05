import { createRequire } from 'node:module';
import { migrations } from './migrations.js';

// node:sqlite is loaded via require: Vitest's module transform does not expose its named export.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

/**
 * Opens the SQLite database and applies any pending migrations.
 * Pass ':memory:' in tests. Foreign keys are on; WAL keeps reads and writes from blocking each other.
 */
export function openDb(file = 'hiretrack.db') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  migrations.forEach((sql, i) => {
    const version = i + 1;
    if (version <= current) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
}

/** Small helpers so repositories stay short. */
export function helpers(db) {
  return {
    one: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    tx(fn) {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

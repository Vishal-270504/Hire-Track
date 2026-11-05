// Fills an empty database with realistic demo data. Usage (from the project root):
//   npm run seed:demo            fill an empty database
//   npm run seed:demo -- --reset delete the database file first, then fill it (stop the app first)
import { existsSync, unlinkSync } from 'node:fs';
import { openDb } from '../db/index.js';
import { seedIfEmpty } from './run.js';
import { seedDemoData } from './demo-data.js';

const file = process.env.DB_FILE ?? 'hiretrack.db';

if (process.argv.includes('--reset')) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) unlinkSync(f);
  console.log('Existing database removed.');
}

const db = openDb(file);
seedIfEmpty(db, { demo: true }); // demo accounts, if this is a new database
const existing = db.prepare('SELECT COUNT(*) AS n FROM candidates').get().n;
if (existing > 0) {
  console.log(`This database already has ${existing} candidate(s), so nothing was added.`);
  console.log('To start clean, stop the app and run: npm run seed:demo -- --reset');
  process.exit(0);
}

const { log, candidates } = seedDemoData(db);
console.log('Demo data added:');
for (const line of log) console.log(`  - ${line}`);
console.log(`Candidates visible to HR: ${candidates}`);
console.log(`Database: ${file}`);
console.log('Sign in with hr@hiretrack.local and password hiretrack-demo.');

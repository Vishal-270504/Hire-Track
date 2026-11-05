import { openDb } from './db/index.js';
import { buildApp } from './app.js';
import { seedIfEmpty } from './seed/run.js';
import { runReminders } from './reminders/engine.js';

const file = process.env.DB_FILE ?? 'hiretrack.db';
const port = Number(process.env.PORT ?? 3001);

const db = openDb(file);
seedIfEmpty(db, { demo: process.env.NODE_ENV !== 'production' });

const app = await buildApp({ db });
// Background pass: keeps reminders fresh even when nobody is looking at the app.
setInterval(() => { try { runReminders(db, new Date()); } catch (e) { console.error('reminder pass failed', e); } }, 60_000);
await app.listen({ port, host: '127.0.0.1' });
console.log(`HireTrack API on http://localhost:${port} (database: ${file})`);

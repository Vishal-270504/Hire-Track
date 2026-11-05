import { helpers } from '../db/index.js';
import { RULES as CORE_RULES } from './rules.js';
import { RULES2 } from './rules2.js';

const RULES = [...CORE_RULES, ...RULES2];
import { expireOffers } from '../services/offers.js';
import { insertReminder } from './store.js';

/**
 * Runs every rule, adds what is due, and withdraws automatic reminders whose cause has gone
 * (for example feedback that has now been submitted). Safe to run as often as you like.
 */
export function runReminders(db, now) {
  const at = now.toISOString();
  const produced = new Set();
  expireOffers(db, now);
  for (const rule of RULES) {
    for (const item of rule.run(db, now)) {
      if (item.dueAt > at) continue; // not due yet
      const base = { ...item, kind: rule.kind, auto: rule.auto };
      if (item.userIds?.length) {
        // One reminder per person, so each panel member sees their own copy and can mark it done.
        for (const userId of item.userIds) {
          const key = `${item.dedupeKey}:${userId}`;
          insertReminder(db, { ...base, dedupeKey: key, userId }, at);
          produced.add(key);
        }
      } else {
        insertReminder(db, base, at);
        produced.add(item.dedupeKey);
      }
    }
  }
  withdrawResolved(db, at, produced);
}

/** Automatic reminders that were not produced this run are finished: their cause is gone. */
function withdrawResolved(db, at, produced) {
  const open = helpers(db).all("SELECT id, dedupe_key FROM reminders WHERE done_at IS NULL AND auto = 1");
  for (const r of open) {
    const base = r.dedupe_key;
    const stillDue = [...produced].some((k) => k === base || k.startsWith(`${base}:`));
    if (!stillDue) helpers(db).run('UPDATE reminders SET done_at = ? WHERE id = ?', at, r.id);
  }
}

/** Reminders a person should see: their own, plus role-wide ones for their role. */
export function remindersFor(db, user) {
  return helpers(db).all(
    `SELECT r.id, r.kind, r.title, r.body, r.due_at, r.candidate_id, r.round_id, r.done_at,
            c.name AS candidate_name
       FROM reminders r LEFT JOIN candidates c ON c.id = r.candidate_id
      WHERE r.done_at IS NULL
        AND (r.audience_user_id = ? OR (r.audience_user_id IS NULL AND r.audience_role = ?))
      ORDER BY r.due_at ASC, r.id ASC`,
    user.id, user.role,
  );
}

export function markDone(db, user, id, at) {
  const row = helpers(db).one(
    `SELECT id FROM reminders WHERE id = ? AND done_at IS NULL
       AND (audience_user_id = ? OR (audience_user_id IS NULL AND audience_role = ?))`,
    id, user.id, user.role,
  );
  if (!row) return false;
  helpers(db).run('UPDATE reminders SET done_at = ? WHERE id = ?', at, id);
  return true;
}

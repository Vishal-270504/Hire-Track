import { helpers } from '../db/index.js';

/** Adds a reminder once. Re-running the same rule never creates a duplicate. */
export function insertReminder(db, r, at) {
  helpers(db).run(
    `INSERT OR IGNORE INTO reminders (dedupe_key, kind, title, body, due_at, candidate_id, round_id,
       audience_user_id, audience_role, auto, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.dedupeKey, r.kind, r.title, r.body ?? '', r.dueAt, r.candidateId ?? null, r.roundId ?? null,
    r.userId ?? null, r.role ?? null, r.auto ? 1 : 0, at,
  );
}

/** "@Priya" or "@Priya Raman" in a note notifies that person. */
export function addMentionReminders(db, { text, candidateId, candidateName, byName, at }) {
  const people = helpers(db).all('SELECT id, name, role FROM users WHERE active = 1').filter((p) => {
    if (p.role !== 'INTERVIEWER') return true;
    // Interviewers are only notified about candidates on their own panel.
    return !!helpers(db).one('SELECT 1 AS ok FROM interview_panel p JOIN interview_rounds ir ON ir.id = p.interview_round_id WHERE ir.candidate_id = ? AND p.user_id = ?', candidateId, p.id);
  });
  const mentions = [...String(text).matchAll(/@([A-Za-z][A-Za-z .'-]{1,40})/g)].map((m) => m[1].trim().toLowerCase());
  for (const p of people) {
    const full = p.name.toLowerCase();
    const first = full.split(' ')[0];
    if (mentions.some((m) => m === full || m === first || full.startsWith(m + ' '))) {
      insertReminder(db, {
        dedupeKey: `mention:${candidateId}:${p.id}:${at}`,
        kind: 'mention',
        title: `${byName} mentioned you on ${candidateName}`,
        body: text,
        dueAt: at,
        candidateId,
        userId: p.id,
      }, at);
    }
  }
}

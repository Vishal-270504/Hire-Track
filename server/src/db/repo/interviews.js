import { helpers } from '../index.js';

export const toRound = (r) => r && ({
  id: r.id,
  candidateId: r.candidate_id,
  hiringRoundId: r.hiring_round_id,
  position: r.position,
  name: r.name,
  type: r.type,
  status: r.status,
  scheduledAt: r.scheduled_at,
  timeZone: r.time_zone,
  link: r.link,
  reschedules: r.reschedules,
  noShows: r.no_shows,
  testScore: r.test_score,
  testReissued: !!r.test_reissued,
  integrityFlag: !!r.integrity_flag,
  resultNote: r.result_note,
  decidedAt: r.decided_at,
});

export const findRoundRow = (db, id) => helpers(db).one('SELECT * FROM interview_rounds WHERE id = ?', id);

export function roundsForCandidate(db, candidateId) {
  const { all } = helpers(db);
  const rounds = all(
    `SELECT ir.*, hr.skills AS hr_skills, hr.pass_percent AS hr_pass_percent, hr.pass_average AS hr_pass_average,
            hr.who AS hr_who, hr.format AS hr_format, hr.duration_min AS hr_duration
       FROM interview_rounds ir LEFT JOIN hiring_rounds hr ON hr.id = ir.hiring_round_id
      WHERE ir.candidate_id = ? ORDER BY ir.position, ir.id`,
    candidateId,
  ).map((r) => ({
    ...toRound(r),
    skills: r.hr_skills ? JSON.parse(r.hr_skills) : [],
    passPercent: r.hr_pass_percent,
    passAverage: r.hr_pass_average,
    who: r.hr_who,
    format: r.hr_format,
    durationMin: r.hr_duration,
  }));
  const panel = all(
    `SELECT p.*, u.name AS member_name FROM interview_panel p JOIN users u ON u.id = p.user_id
      WHERE p.interview_round_id IN (SELECT id FROM interview_rounds WHERE candidate_id = ?)
      ORDER BY p.id`,
    candidateId,
  );
  return rounds.map((r) => ({
    ...r,
    panel: panel.filter((p) => p.interview_round_id === r.id).map(toPanel),
  }));
}

export const toPanel = (p) => ({
  id: p.id,
  userId: p.user_id,
  name: p.member_name,
  conflict: !!p.conflict,
  conflictNote: p.conflict_note,
  scores: p.scores ? JSON.parse(p.scores) : null,
  avg: p.avg,
  recommendation: p.recommendation,
  comments: p.comments,
  submittedAt: p.submitted_at,
});

export function panelRows(db, roundId) {
  return helpers(db).all('SELECT * FROM interview_panel WHERE interview_round_id = ?', roundId);
}

export function panelMember(db, roundId, userId) {
  return helpers(db).one('SELECT * FROM interview_panel WHERE interview_round_id = ? AND user_id = ?', roundId, userId);
}

export function insertRound(db, candidateId, hiringRoundId, position, def, status) {
  const info = helpers(db).run(
    `INSERT INTO interview_rounds (candidate_id, hiring_round_id, position, name, type, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    candidateId, hiringRoundId, position, def.name, def.type, status,
  );
  return Number(info.lastInsertRowid);
}

const ROUND_COLUMN = {
  status: 'status', scheduledAt: 'scheduled_at', timeZone: 'time_zone', link: 'link', reschedules: 'reschedules',
  noShows: 'no_shows', testScore: 'test_score', testReissued: 'test_reissued', integrityFlag: 'integrity_flag',
  resultNote: 'result_note', decidedAt: 'decided_at',
};

export function updateRoundFields(db, id, fields) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!ROUND_COLUMN[k]) continue;
    sets.push(`${ROUND_COLUMN[k]} = ?`);
    args.push(typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
  }
  if (sets.length) helpers(db).run(`UPDATE interview_rounds SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

export function addPanelMember(db, roundId, userId) {
  helpers(db).run(
    'INSERT OR IGNORE INTO interview_panel (interview_round_id, user_id) VALUES (?, ?)',
    roundId, userId,
  );
}

export function removePanelMember(db, roundId, userId) {
  helpers(db).run(
    'DELETE FROM interview_panel WHERE interview_round_id = ? AND user_id = ? AND submitted_at IS NULL',
    roundId, userId,
  );
}

export function saveFeedback(db, roundId, userId, { scores, avg, recommendation, comments }, at) {
  helpers(db).run(
    `UPDATE interview_panel SET scores = ?, avg = ?, recommendation = ?, comments = ?, submitted_at = ?
      WHERE interview_round_id = ? AND user_id = ?`,
    scores == null ? null : JSON.stringify(scores), avg ?? null, recommendation ?? null, comments ?? null, at,
    roundId, userId,
  );
}

export function declareConflict(db, roundId, userId, note) {
  helpers(db).run(
    'UPDATE interview_panel SET conflict = 1, conflict_note = ? WHERE interview_round_id = ? AND user_id = ?',
    note ?? null, roundId, userId,
  );
}

/** Rounds at a given time for a person, used to suggest a free panel member. */
export function busyAt(db, userId, iso, windowMinutes = 60) {
  return helpers(db).one(
    `SELECT COUNT(*) AS n FROM interview_panel p JOIN interview_rounds ir ON ir.id = p.interview_round_id
      WHERE p.user_id = ? AND ir.status = 'SCHEDULED'
        AND abs(strftime('%s', ir.scheduled_at) - strftime('%s', ?)) < ? * 60`,
    userId, iso, windowMinutes,
  ).n > 0;
}

export function activeRoundSummaries(db, candidateIds) {
  if (!candidateIds.length) return new Map();
  const marks = candidateIds.map(() => '?').join(',');
  const rows = helpers(db).all(
    `SELECT candidate_id, name, status, position FROM interview_rounds
      WHERE candidate_id IN (${marks}) AND status NOT IN ('WAITING','PASSED','SUPERSEDED','SELECTED')
      ORDER BY position`,
    ...candidateIds,
  );
  const map = new Map();
  for (const r of rows) if (!map.has(r.candidate_id)) map.set(r.candidate_id, r);
  return map;
}

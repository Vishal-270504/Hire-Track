import { helpers } from '../index.js';

const json = (v) => JSON.stringify(v ?? []);
const list = (s) => (s ? JSON.parse(s) : []);

/** Database row -> the shape the API and UI use (camelCase, real booleans and arrays). */
export const toRequisition = (r, extra = {}) => r && ({
  id: r.id,
  title: r.title,
  level: r.level,
  headcount: r.headcount,
  team: r.team,
  location: r.location,
  remote: !!r.remote,
  budgetMaxLpa: r.budget_max_lpa,
  targetJoinDate: r.target_join_date,
  jdText: r.jd_text,
  mustSkills: list(r.must_skills),
  goodSkills: list(r.good_skills),
  expMin: r.exp_min,
  expMax: r.exp_max,
  noticeMaxDays: r.notice_max_days,
  status: r.status,
  statusReason: r.status_reason,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version,
  ...extra,
});

const toRound = (r) => ({
  id: r.id,
  position: r.position,
  name: r.name,
  type: r.type,
  durationMin: r.duration_min,
  format: r.format,
  who: r.who,
  passPercent: r.pass_percent,
  passAverage: r.pass_average,
  skills: list(r.skills),
  optional: !!r.optional,
});

const toApproval = (a) => ({
  id: a.id,
  position: a.position,
  label: a.label,
  approverId: a.approver_id,
  approverName: a.approver_name,
  status: a.status,
  comment: a.comment,
  decidedAt: a.decided_at,
});

const PROGRESS = `
  (SELECT COUNT(*) FROM requisition_approvals a WHERE a.requisition_id = r.id AND a.status = 'APPROVED') AS approved_steps,
  (SELECT COUNT(*) FROM requisition_approvals a WHERE a.requisition_id = r.id) AS total_steps`;

export function listRequisitions(db, { status } = {}) {
  const rows = helpers(db).all(
    `SELECT r.*, ${PROGRESS} FROM requisitions r
      WHERE (? IS NULL OR r.status = ?)
      ORDER BY r.updated_at DESC, r.id DESC`,
    status ?? null, status ?? null,
  );
  return rows.map((r) => toRequisition(r, {
    approvedSteps: r.approved_steps,
    totalSteps: r.total_steps,
  }));
}

export function findRequisitionRow(db, id) {
  return helpers(db).one('SELECT * FROM requisitions WHERE id = ?', id);
}

export function loadRequisition(db, id) {
  const row = findRequisitionRow(db, id);
  if (!row) return null;
  const { all } = helpers(db);
  const rounds = all('SELECT * FROM hiring_rounds WHERE requisition_id = ? ORDER BY position', id).map(toRound);
  const approvals = all(
    `SELECT a.*, u.name AS approver_name FROM requisition_approvals a
       JOIN users u ON u.id = a.approver_id
      WHERE a.requisition_id = ? ORDER BY a.position`,
    id,
  ).map(toApproval);
  return toRequisition(row, { rounds, approvals });
}

export function insertRequisition(db, data, actorId, now) {
  const info = helpers(db).run(
    `INSERT INTO requisitions (title, level, headcount, team, location, remote, budget_max_lpa, target_join_date,
       jd_text, must_skills, good_skills, exp_min, exp_max, notice_max_days, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
    data.title, data.level ?? null, data.headcount ?? 1, data.team ?? null, data.location ?? null,
    data.remote ? 1 : 0, data.budgetMaxLpa ?? null, data.targetJoinDate ?? null, data.jdText ?? '',
    json(data.mustSkills), json(data.goodSkills), data.expMin ?? null, data.expMax ?? null,
    data.noticeMaxDays ?? null, actorId, now, now,
  );
  return Number(info.lastInsertRowid);
}

const COLUMN = {
  title: 'title', level: 'level', headcount: 'headcount', team: 'team', location: 'location',
  remote: 'remote', budgetMaxLpa: 'budget_max_lpa', targetJoinDate: 'target_join_date', jdText: 'jd_text',
  mustSkills: 'must_skills', goodSkills: 'good_skills', expMin: 'exp_min', expMax: 'exp_max',
  noticeMaxDays: 'notice_max_days', status: 'status', statusReason: 'status_reason',
};

/** Writes only the fields given, and bumps the version so stale edits are caught. */
export function updateRequisitionFields(db, id, fields, now) {
  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!COLUMN[key]) continue;
    sets.push(`${COLUMN[key]} = ?`);
    args.push(key === 'mustSkills' || key === 'goodSkills' ? json(value)
      : key === 'remote' ? (value ? 1 : 0) : value ?? null);
  }
  sets.push('updated_at = ?', 'version = version + 1');
  helpers(db).run(`UPDATE requisitions SET ${sets.join(', ')} WHERE id = ?`, ...args, now, id);
}

export function deleteRequisition(db, id) {
  helpers(db).run('DELETE FROM requisitions WHERE id = ?', id);
}

export function countStaleCheck(db, id, version) {
  return helpers(db).one('SELECT version FROM requisitions WHERE id = ?', id)?.version === version;
}

export function replaceApprovals(db, reqId, steps) {
  const { run } = helpers(db);
  run('DELETE FROM requisition_approvals WHERE requisition_id = ?', reqId);
  steps.forEach((s, i) => run(
    'INSERT INTO requisition_approvals (requisition_id, position, label, approver_id) VALUES (?, ?, ?, ?)',
    reqId, i + 1, s.label, s.approverId,
  ));
}

export function setApprovalDecision(db, stepId, status, comment, now) {
  helpers(db).run(
    'UPDATE requisition_approvals SET status = ?, comment = ?, decided_at = ? WHERE id = ?',
    status, comment ?? null, now, stepId,
  );
}

export function findApproval(db, reqId, stepId) {
  return helpers(db).one(
    'SELECT * FROM requisition_approvals WHERE id = ? AND requisition_id = ?', stepId, reqId,
  );
}

export function approvalsFor(db, reqId) {
  return helpers(db).all('SELECT * FROM requisition_approvals WHERE requisition_id = ? ORDER BY position', reqId);
}

export function findRound(db, id) {
  return helpers(db).one('SELECT * FROM hiring_rounds WHERE id = ?', id);
}

export function insertRound(db, reqId, position, r) {
  const info = helpers(db).run(
    `INSERT INTO hiring_rounds (requisition_id, position, name, type, duration_min, format, who,
       pass_percent, pass_average, skills, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    reqId, position, r.name, r.type, r.durationMin ?? null, r.format ?? '', r.who ?? '',
    r.passPercent ?? null, r.passAverage ?? null, json(r.skills), r.optional ? 1 : 0,
  );
  return Number(info.lastInsertRowid);
}

export function updateRound(db, id, position, r) {
  helpers(db).run(
    `UPDATE hiring_rounds SET position = ?, name = ?, type = ?, duration_min = ?, format = ?, who = ?,
       pass_percent = ?, pass_average = ?, skills = ?, optional = ? WHERE id = ?`,
    position, r.name, r.type, r.durationMin ?? null, r.format ?? '', r.who ?? '',
    r.passPercent ?? null, r.passAverage ?? null, json(r.skills), r.optional ? 1 : 0, id,
  );
}

export function deleteRound(db, id) {
  helpers(db).run('DELETE FROM hiring_rounds WHERE id = ?', id);
}

export function roundIdsFor(db, reqId) {
  return helpers(db).all('SELECT id FROM hiring_rounds WHERE requisition_id = ?', reqId).map((r) => r.id);
}

/** Approver choices: active people who can approve a job (HR, recruiters, admins). */
export function approverOptions(db) {
  return helpers(db).all(
    `SELECT id, name, role FROM users WHERE active = 1 AND role IN ('HR','RECRUITER','ADMIN') ORDER BY name`,
  );
}

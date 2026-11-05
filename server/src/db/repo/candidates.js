import { helpers } from '../index.js';

const list = (s) => (s ? JSON.parse(s) : []);

/** Row -> API shape. Salary fields are added by the service only for people allowed to see them. */
export const toCandidate = (r, extra = {}) => r && ({
  id: r.id,
  requisitionId: r.requisition_id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  pan: r.pan,
  location: r.location,
  source: r.source,
  sourceDetail: r.source_detail,
  experienceYears: r.experience_years,
  noticeDays: r.notice_days,
  workAuth: r.work_auth == null ? null : !!r.work_auth,
  shiftOk: r.shift_ok == null ? null : !!r.shift_ok,
  resumeText: r.resume_text,
  portfolioUrl: r.portfolio_url,
  githubUrl: r.github_url,
  stage: r.stage,
  status: r.status,
  atsScore: r.ats_score,
  atsBreakdown: r.ats_breakdown ? JSON.parse(r.ats_breakdown) : {},
  matchedSkills: list(r.matched_skills),
  missingSkills: list(r.missing_skills),
  flags: list(r.flags),
  onHold: !!r.on_hold,
  holdReason: r.hold_reason,
  phase: r.phase,
  joinDate: r.join_date,
  joinDateChanges: r.join_date_changes,
  subjectToBgv: !!r.subject_to_bgv,
  buddy: r.buddy,
  manager: r.manager,
  relievingStatus: r.relieving_status,
  relievingDue: r.relieving_due,
  appliedVia: r.applied_via,
  anonymisedAt: r.anonymised_at,
  phase: r.phase,
  joinDate: r.join_date,
  joinDateChanges: r.join_date_changes,
  subjectToBgv: !!r.subject_to_bgv,
  buddy: r.buddy,
  manager: r.manager,
  relievingStatus: r.relieving_status,
  relievingDue: r.relieving_due,
  appliedVia: r.applied_via,
  anonymisedAt: r.anonymised_at,
  phase: r.phase,
  joinDate: r.join_date,
  joinDateChanges: r.join_date_changes,
  subjectToBgv: !!r.subject_to_bgv,
  buddy: r.buddy,
  manager: r.manager,
  relievingStatus: r.relieving_status,
  relievingDue: r.relieving_due,
  appliedVia: r.applied_via,
  anonymisedAt: r.anonymised_at,
  phoneScreenNotes: r.phone_screen_notes,
  noticeApprovedBy: r.notice_approved_by,
  followUpDate: r.follow_up_date,
  ownerId: r.owner_id,
  linkedToId: r.linked_to_id,
  closedReason: r.closed_reason,
  rejectedAt: r.rejected_at,
  rejectReason: r.reject_reason,
  rejectUndoUntil: r.reject_undo_until,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version,
  ...extra,
});

export const findCandidateRow = (db, id) => helpers(db).one('SELECT * FROM candidates WHERE id = ?', id);

/** Digits only, last 10 of a phone number, so +91 98xxx and 98xxx match. */
export const normPhone = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

/** Existing applications that look like the same person (email, phone or PAN). */
export function findDuplicates(db, { email, phone, pan }, excludeId = null) {
  const p = normPhone(phone);
  return helpers(db).all(
    `SELECT c.*, r.title AS requisition_title FROM candidates c
       JOIN requisitions r ON r.id = c.requisition_id
      WHERE c.id IS NOT ?
        AND ((? <> '' AND c.email = ? COLLATE NOCASE)
          OR (? <> '' AND substr(replace(replace(replace(c.phone,' ',''),'-',''),'+',''), -10) = ?)
          OR (? <> '' AND c.pan = ? COLLATE NOCASE))
      ORDER BY c.id DESC`,
    excludeId,
    email ?? '', email ?? '',
    p, p,
    pan ?? '', pan ?? '',
  );
}

export function insertCandidate(db, c, now) {
  const info = helpers(db).run(
    `INSERT INTO candidates (requisition_id, name, email, phone, pan, location, source, source_detail,
       experience_years, current_ctc_lpa, expected_ctc_lpa, notice_days, work_auth, shift_ok, resume_text,
       portfolio_url, github_url, stage, status, ats_score, ats_breakdown, matched_skills, missing_skills, flags,
       owner_id, linked_to_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SCREENING',?,?,?,?,?,?,?,?,?,?)`,
    c.requisitionId, c.name, c.email ?? '', c.phone ?? '', c.pan ?? '', c.location ?? '', c.source ?? '',
    c.sourceDetail ?? '', c.experienceYears ?? null, c.currentCtcLpa ?? null, c.expectedCtcLpa ?? null,
    c.noticeDays ?? null, c.workAuth == null ? null : c.workAuth ? 1 : 0, c.shiftOk == null ? null : c.shiftOk ? 1 : 0,
    c.resumeText ?? '', c.portfolioUrl ?? '', c.githubUrl ?? '', c.status, c.atsScore ?? null,
    JSON.stringify(c.atsBreakdown ?? {}), JSON.stringify(c.matchedSkills ?? []), JSON.stringify(c.missingSkills ?? []),
    JSON.stringify(c.flags ?? []), c.ownerId ?? null, c.linkedToId ?? null, now, now,
  );
  return Number(info.lastInsertRowid);
}

const COLUMN = {
  name: 'name', email: 'email', phone: 'phone', pan: 'pan', location: 'location', source: 'source',
  sourceDetail: 'source_detail', experienceYears: 'experience_years', currentCtcLpa: 'current_ctc_lpa',
  expectedCtcLpa: 'expected_ctc_lpa', noticeDays: 'notice_days', workAuth: 'work_auth', shiftOk: 'shift_ok',
  resumeText: 'resume_text', portfolioUrl: 'portfolio_url', githubUrl: 'github_url', stage: 'stage',
  status: 'status', atsScore: 'ats_score', atsBreakdown: 'ats_breakdown', matchedSkills: 'matched_skills',
  missingSkills: 'missing_skills', flags: 'flags', onHold: 'on_hold', holdReason: 'hold_reason',
  phoneScreenNotes: 'phone_screen_notes', noticeApprovedBy: 'notice_approved_by', followUpDate: 'follow_up_date',
  ownerId: 'owner_id', closedReason: 'closed_reason', rejectedAt: 'rejected_at', rejectReason: 'reject_reason',
  rejectUndoUntil: 'reject_undo_until', undoSnapshot: 'undo_snapshot', requisitionId: 'requisition_id',
  linkedToId: 'linked_to_id',
  phase: 'phase', joinDate: 'join_date', joinDateChanges: 'join_date_changes', subjectToBgv: 'subject_to_bgv',
  buddy: 'buddy', manager: 'manager', relievingStatus: 'relieving_status', relievingDue: 'relieving_due',
  token: 'token', appliedVia: 'applied_via', anonymisedAt: 'anonymised_at',
};
const JSON_FIELDS = new Set(['atsBreakdown', 'matchedSkills', 'missingSkills', 'flags', 'undoSnapshot']);
const BOOL_FIELDS = new Set(['workAuth', 'shiftOk', 'onHold', 'subjectToBgv']);

/** Writes only the fields given; bumps version so a stale edit is detected by the caller. */
export function updateCandidateFields(db, id, fields, now) {
  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!COLUMN[key]) continue;
    sets.push(`${COLUMN[key]} = ?`);
    if (JSON_FIELDS.has(key)) args.push(value == null ? null : JSON.stringify(value));
    else if (BOOL_FIELDS.has(key)) args.push(value == null ? null : value ? 1 : 0);
    else args.push(value ?? null);
  }
  sets.push('updated_at = ?', 'version = version + 1');
  helpers(db).run(`UPDATE candidates SET ${sets.join(', ')} WHERE id = ?`, ...args, now, id);
}

export function addEvent(db, candidateId, { at, userId = null, kind = 'system', text }) {
  helpers(db).run(
    'INSERT INTO candidate_events (candidate_id, at, user_id, kind, text) VALUES (?, ?, ?, ?, ?)',
    candidateId, at, userId, kind, text,
  );
}

export function eventsFor(db, candidateId) {
  return helpers(db).all(
    `SELECT e.id, e.at, e.kind, e.text, u.name AS by_name FROM candidate_events e
       LEFT JOIN users u ON u.id = e.user_id WHERE e.candidate_id = ? ORDER BY e.id DESC`,
    candidateId,
  );
}

/**
 * Candidate list. Interviewers only see people they are on a panel for; everyone else
 * sees all candidates for the roles they can access.
 */
export function listCandidateRows(db, { viewerId = null, stage, requisitionId, q, status, onHold, ownerId } = {}) {
  const rawId = q ? String(q).trim().toLowerCase() : null;
  const term = rawId ? `%${rawId}%` : null;
  return helpers(db).all(
    `SELECT c.*, r.title AS requisition_title, r.budget_max_lpa AS budget_max_lpa, r.notice_max_days AS notice_max_days,
            r.status AS requisition_status, u.name AS owner_name
       FROM candidates c
       JOIN requisitions r ON r.id = c.requisition_id
       LEFT JOIN users u ON u.id = c.owner_id
      WHERE (? IS NULL OR c.stage = ?)
        AND (? IS NULL OR c.requisition_id = ?)
        AND (? IS NULL OR c.status = ?)
        AND (? IS NULL OR c.on_hold = ?)
        AND (? IS NULL OR c.owner_id = ?)
        AND (? IS NULL OR lower(c.name) LIKE ? OR lower(c.email) LIKE ? OR replace(c.phone,' ','') LIKE ?
             OR lower(c.pan) LIKE ? OR CAST(c.id AS TEXT) = ? OR lower(r.title) LIKE ?)
        AND (? IS NULL OR EXISTS (
              SELECT 1 FROM interview_rounds ir JOIN interview_panel p ON p.interview_round_id = ir.id
               WHERE ir.candidate_id = c.id AND p.user_id = ?))
      ORDER BY c.updated_at DESC, c.id DESC`,
    stage ?? null, stage ?? null,
    requisitionId ?? null, requisitionId ?? null,
    status ?? null, status ?? null,
    onHold == null ? null : onHold ? 1 : 0, onHold == null ? null : onHold ? 1 : 0,
    ownerId ?? null, ownerId ?? null,
    term, term, term, term, term, rawId, term,
    viewerId, viewerId,
  );
}

export function openRoundsCount(db, candidateId) {
  return helpers(db).one(
    "SELECT COUNT(*) AS n FROM interview_rounds WHERE candidate_id = ? AND status NOT IN ('PASSED','SUPERSEDED','SELECTED')",
    candidateId,
  ).n;
}

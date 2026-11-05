import { z } from 'zod';
import { rule, notFound, forbidden } from '../errors.js';
import { audit } from '../audit/index.js';
import { helpers } from '../db/index.js';
import { updateCandidateFields, addEvent } from '../db/repo/candidates.js';
import { findRequisitionRow } from '../db/repo/requisitions.js';
import { policy } from '../policy/index.js';
import { requireCandidate, getCandidate } from './candidates.js';

const iso = (d) => d.toISOString();
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const DOC_STATUSES = ['VERIFIED', 'REJECTED', 'LATER', 'AFFIDAVIT'];
const COMPLETE = ['VERIFIED', 'LATER', 'AFFIDAVIT'];

// ---------- documents (HR and admin see these; the candidate uploads through the portal) ----------

/** Makes sure every checklist document exists for the candidate, so nothing is forgotten. */
export function ensureDocuments(db, candidateId, now = new Date()) {
  const { all, run } = helpers(db);
  const have = new Set(all('SELECT doc_type FROM documents WHERE candidate_id = ?', candidateId).map((r) => r.doc_type));
  for (const docType of policy(db, 'checklists.documents')) {
    if (!have.has(docType)) {
      run("INSERT INTO documents (candidate_id, doc_type, status, updated_at) VALUES (?, ?, 'PENDING', ?)", candidateId, docType, iso(now));
    }
  }
}

export function listDocuments(db, actor, candidateId, now = new Date()) {
  requireCandidate(db, actor, candidateId);
  ensureDocuments(db, candidateId, now);
  return helpers(db).all(
    `SELECT d.id, d.doc_type AS docType, d.status, d.reason, d.note, d.verified_by AS verifiedBy, d.updated_at AS updatedAt,
            f.filename, f.size
       FROM documents d LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.candidate_id = ? ORDER BY d.id`,
    candidateId,
  ).map((d) => ({ ...d, hasFile: !!d.filename }));
}

/** Store a file for a document. Used by HR, and by the candidate through the portal. */
export function storeDocumentFile(db, documentId, { filename, mime, data }, now, actor = null) {
  const doc = helpers(db).one('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc) throw notFound('That document');
  if (data.length > 5 * 1024 * 1024) throw rule('That file is larger than 5 MB. Upload a smaller copy.', 'too_large');
  helpers(db).tx(() => {
    helpers(db).run('DELETE FROM document_files WHERE document_id = ?', documentId);
    helpers(db).run('INSERT INTO document_files (document_id, filename, mime, size, data, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)',
      documentId, filename, mime, data.length, data, iso(now));
    helpers(db).run("UPDATE documents SET status = 'SUBMITTED', reason = NULL, updated_at = ? WHERE id = ?", iso(now), documentId);
  });
  addEvent(db, doc.candidate_id, { at: iso(now), userId: actor?.id ?? null, kind: 'system', text: `Document uploaded: ${doc.doc_type} (${filename}).` });
  return { ok: true };
}

export function documentFile(db, actor, documentId) {
  const doc = helpers(db).one('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc) throw notFound('That document');
  requireCandidate(db, actor, doc.candidate_id);
  const f = helpers(db).one('SELECT * FROM document_files WHERE document_id = ?', documentId);
  if (!f) throw notFound('No file has been uploaded for this document');
  return f;
}

const ReviewDoc = z.object({
  status: z.enum(DOC_STATUSES, { errorMap: () => ({ message: 'Choose a status.' }) }),
  reason: z.string().optional(),
  note: z.string().optional(),
});

/** HR checks a document. Rejection needs the reason shown to the candidate; affidavit or later need a note. */
export function reviewDocument(db, actor, documentId, body, now) {
  const doc = helpers(db).one('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc) throw notFound('That document');
  requireCandidate(db, actor, doc.candidate_id);
  const input = ReviewDoc.parse(body ?? {});
  const text = (input.reason ?? input.note ?? '').trim();
  if (input.status === 'REJECTED' && text.length < 3) {
    throw rule('Say what is wrong with it, so the candidate can upload the right one.', 'reason_required', { reason: 'Say what is wrong.' });
  }
  if ((input.status === 'AFFIDAVIT' || input.status === 'LATER') && (input.note ?? '').trim().length < 3) {
    throw rule(input.status === 'AFFIDAVIT' ? 'Add a note on the affidavit or gazette notice.' : 'Add a note on when it will be collected.', 'note_required', { note: 'Add a short note.' });
  }
  if (input.status === 'VERIFIED' && doc.status !== 'SUBMITTED') {
    throw rule('Only a submitted document can be verified. Ask for the file first.', 'not_submitted');
  }
  helpers(db).run(
    'UPDATE documents SET status = ?, reason = ?, note = ?, verified_by = ?, updated_at = ? WHERE id = ?',
    input.status, input.status === 'REJECTED' ? text : null, input.note?.trim() || null, actor.name, iso(now), documentId,
  );
  addEvent(db, doc.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `${doc.doc_type}: ${input.status.toLowerCase()}${text ? ` (${text})` : ''}` });
  audit(db, { at: iso(now), userId: actor.id, action: 'document.review', entity: 'candidate', entityId: doc.candidate_id, detail: { docType: doc.doc_type, status: input.status } });
  return getCandidate(db, actor, doc.candidate_id);
}

export function documentsMissing(db, candidateId) {
  ensureDocuments(db, candidateId);
  return helpers(db).all(
    'SELECT doc_type FROM documents WHERE candidate_id = ? AND status NOT IN (?, ?, ?)',
    candidateId, ...COMPLETE,
  ).map((r) => r.doc_type);
}

// ---------- background checks ----------

export function ensureBgv(db, candidateId, now = new Date()) {
  const have = new Set(helpers(db).all('SELECT check_type FROM bgv_checks WHERE candidate_id = ?', candidateId).map((r) => r.check_type));
  for (const t of policy(db, 'bgvChecks')) {
    if (!have.has(t)) helpers(db).run("INSERT INTO bgv_checks (candidate_id, check_type, status, updated_at) VALUES (?, ?, 'PENDING', ?)", candidateId, t, iso(now));
  }
}

export function listBgv(db, actor, candidateId, now = new Date()) {
  requireCandidate(db, actor, candidateId);
  ensureBgv(db, candidateId, now);
  return helpers(db).all('SELECT id, check_type AS checkType, status, note, updated_at AS updatedAt FROM bgv_checks WHERE candidate_id = ? ORDER BY id', candidateId);
}

/** Overall result: any flag wins, then pending, then clear. */
export function bgvSummary(rows) {
  if (!rows.length) return 'NOT_STARTED';
  if (rows.some((r) => r.status === 'FLAGGED')) return 'FLAGGED';
  if (rows.every((r) => r.status === 'CLEAR')) return 'CLEAR';
  if (rows.some((r) => r.status === 'IN_PROGRESS' || r.status === 'CLEAR')) return 'IN_PROGRESS';
  return 'PENDING';
}

export function setBgv(db, actor, candidateId, { checkType, status, note }, now) {
  requireCandidate(db, actor, candidateId);
  ensureBgv(db, candidateId, now);
  if (!policy(db, 'bgvChecks').includes(checkType)) throw notFound('That background check');
  if (!['PENDING', 'IN_PROGRESS', 'CLEAR', 'FLAGGED'].includes(status)) throw rule('Choose a status for the check.', 'bad_status');
  if (status === 'FLAGGED' && (note ?? '').trim().length < 3) {
    throw rule('Describe what the check found. The HR head decides what happens next.', 'reason_required', { note: 'Describe what was found.' });
  }
  helpers(db).run('UPDATE bgv_checks SET status = ?, note = ?, updated_at = ? WHERE candidate_id = ? AND check_type = ?',
    status, (note ?? '').trim(), iso(now), candidateId, checkType);
  const rows = listBgv(db, actor, candidateId, now);
  const summary = bgvSummary(rows);
  const cand = helpers(db).one('SELECT * FROM candidates WHERE id = ?', candidateId);
  if (summary === 'FLAGGED') {
    updateCandidateFields(db, candidateId, { onHold: true, holdReason: `Background check flagged: ${checkType}. HR head to decide.`, status: 'Background check flagged' }, iso(now));
  } else if (summary === 'CLEAR' && cand.hold_reason?.startsWith('Background check flagged')) {
    updateCandidateFields(db, candidateId, { onHold: false, holdReason: null, status: 'Background check clear' }, iso(now));
  }
  if (summary === 'CLEAR') {
    helpers(db).run("UPDATE employees SET access_restricted = 0 WHERE candidate_id = ?", candidateId);
  }
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'system', text: `Background check ${checkType}: ${status.toLowerCase().replace('_', ' ')}${note ? ` (${note})` : ''}.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'bgv.update', entity: 'candidate', entityId: candidateId, detail: { checkType, status } });
  return getCandidate(db, actor, candidateId);
}

// ---------- prep tasks and check-ins ----------

export function createPrepTasks(db, candidateId, joinDate, now) {
  const join = new Date(`${joinDate}T00:00:00Z`);
  const today = day(now);
  for (const t of policy(db, 'prepTasks')) {
    let due = day(addDays(join, t.offsetDays));
    if (due < today) due = today;
    helpers(db).run(
      "INSERT INTO tasks (candidate_id, title, owner_team, kind, offset_days, due_on, status, created_at) VALUES (?, ?, ?, 'PREP', ?, ?, 'OPEN', ?)",
      candidateId, t.title, t.team, t.offsetDays, due, iso(now),
    );
  }
}

/** Moves open prep tasks when the joining date changes. */
export function shiftPrepTasks(db, candidateId, deltaDays) {
  helpers(db).run(
    "UPDATE tasks SET due_on = date(due_on, ? || ' days') WHERE candidate_id = ? AND status = 'OPEN' AND kind = 'PREP'",
    String(deltaDays), candidateId,
  );
}

export function cancelOpenTasks(db, candidateId) {
  helpers(db).run("UPDATE tasks SET status = 'CANCELLED' WHERE candidate_id = ? AND status = 'OPEN' AND kind = 'PREP'", candidateId);
}

export function listTasks(db, candidateId) {
  return helpers(db).all(
    `SELECT id, title, owner_team AS ownerTeam, kind, due_on AS dueOn, status, done_at AS doneAt
       FROM tasks WHERE candidate_id = ? ORDER BY due_on, id`,
    candidateId,
  );
}

const TASK_ROLE = { HR: ['HR', 'ADMIN'], IT: ['IT', 'ADMIN'], ADMIN: ['ADMIN', 'HR'] };

export function completeTask(db, actor, taskId, now) {
  const t = helpers(db).one('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t) throw notFound('That task');
  requireCandidate(db, actor, t.candidate_id);
  if (!TASK_ROLE[t.owner_team].includes(actor.role) && actor.role !== 'RECRUITER') {
    throw forbidden(`This task belongs to the ${t.owner_team} team.`);
  }
  if (t.status !== 'OPEN') throw rule('This task is already finished.', 'not_open');
  helpers(db).run("UPDATE tasks SET status = 'DONE', done_at = ?, done_by = ? WHERE id = ?", iso(now), actor.id, taskId);
  addEvent(db, t.candidate_id, { at: iso(now), userId: actor.id, kind: 'system', text: `Done: ${t.title}.` });
  return getCandidate(db, actor, t.candidate_id);
}

export function addCheckin(db, actor, candidateId, { note }, now) {
  requireCandidate(db, actor, candidateId);
  const text = (note ?? '').trim();
  if (text.length < 3) throw rule('Write a line on how the check-in went.', 'empty_note', { note: 'Write a line.' });
  helpers(db).run('INSERT INTO checkins (candidate_id, at, user_id, note) VALUES (?, ?, ?, ?)', candidateId, iso(now), actor.id, text);
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'note', text: `Check-in: ${text}` });
  return getCandidate(db, actor, candidateId);
}

export function listCheckins(db, candidateId) {
  return helpers(db).all('SELECT c.id, c.at, c.note, u.name AS by FROM checkins c LEFT JOIN users u ON u.id = c.user_id WHERE c.candidate_id = ? ORDER BY c.at DESC', candidateId);
}

// ---------- joining details ----------

export function changeJoinDate(db, actor, candidateId, { joinDate, reason }, now) {
  const cand = requireCandidate(db, actor, candidateId);
  if (cand.phase !== 'PRE_JOINING') throw rule('The joining date can only change before Day 1.', 'wrong_phase');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate ?? '')) throw rule('Pick a joining date.', 'bad_date', { joinDate: 'Pick a date.' });
  const max = policy(db, 'joining.maxDateChanges');
  if (cand.join_date_changes >= max) {
    throw rule(`The joining date has already been changed ${max} time${max === 1 ? '' : 's'}. Ask HR to make a decision.`, 'change_limit');
  }
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Say why the date is changing.', 'reason_required', { reason: 'Add a reason.' });
  const delta = Math.round((new Date(`${joinDate}T00:00:00Z`) - new Date(`${cand.join_date}T00:00:00Z`)) / 86_400_000);
  helpers(db).tx(() => {
    helpers(db).run("UPDATE offers SET join_date = ? WHERE candidate_id = ? AND status = 'ACCEPTED'", joinDate, candidateId);
    shiftPrepTasks(db, candidateId, delta);
    updateCandidateFields(db, candidateId, { joinDate, joinDateChanges: cand.join_date_changes + 1 }, iso(now));
  });
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `Joining date moved to ${joinDate}: ${why}. Tasks moved by ${delta} days.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'join.date_change', entity: 'candidate', entityId: candidateId, reason: why });
  return getCandidate(db, actor, candidateId);
}

export function setPeople(db, actor, candidateId, { buddy, manager }, now) {
  requireCandidate(db, actor, candidateId);
  updateCandidateFields(db, candidateId, { buddy: (buddy ?? '').trim(), manager: (manager ?? '').trim() }, iso(now));
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'system', text: `Buddy: ${(buddy ?? '').trim() || 'not set'}. Manager: ${(manager ?? '').trim() || 'not set'}.` });
  return getCandidate(db, actor, candidateId);
}

/** Relieving letter: received, or later (HR is reminded 30 days after joining). */
export function setRelieving(db, actor, candidateId, { status }, now) {
  requireCandidate(db, actor, candidateId);
  if (!['RECEIVED', 'LATER'].includes(status)) throw rule('Choose received or later.', 'bad_status');
  const due = status === 'LATER' ? day(addDays(now, policy(db, 'joining.relievingLetterDays'))) : null;
  updateCandidateFields(db, candidateId, { relievingStatus: status, relievingDue: due }, iso(now));
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'system', text: status === 'LATER' ? `Relieving letter to follow by ${due}.` : 'Relieving letter received.' });
  return getCandidate(db, actor, candidateId);
}

function joinBlockers(db, candidateId, { subjectToBgv }) {
  const out = [];
  if (!helpers(db).one("SELECT id FROM offers WHERE candidate_id = ? AND status = 'ACCEPTED'", candidateId)) out.push('The offer must be signed first.');
  const missing = documentsMissing(db, candidateId);
  if (missing.length) out.push(`Documents still outstanding: ${missing.join(', ')}.`);
  ensureBgv(db, candidateId);
  const bgv = bgvSummary(helpers(db).all('SELECT status FROM bgv_checks WHERE candidate_id = ?', candidateId));
  if (bgv === 'FLAGGED') out.push('A background check is flagged. Resolve it before joining.');
  else if (bgv !== 'CLEAR' && !subjectToBgv) out.push('Background checks are not complete. Tick "join subject to background check" to go ahead with restricted access.');
  return out;
}

/** Day 1: the employee record is created, onboarding items are listed, and probation waits for access. */
export function joinCandidate(db, actor, candidateId, { subjectToBgv = false, relievingLater = false }, now) {
  const cand = requireCandidate(db, actor, candidateId);
  if (cand.phase !== 'PRE_JOINING') throw rule('Only a candidate in pre-joining can join.', 'wrong_phase');
  const blockers = joinBlockers(db, candidateId, { subjectToBgv });
  if (blockers.length) throw rule(`Before Day 1: ${blockers.join(' ')}`, 'not_ready');

  const code = nextEmployeeCode(db);
  const email = uniqueCompanyEmail(db, cand.name);
  const joinedOn = cand.join_date ?? day(now);
  helpers(db).tx(() => {
    const info = helpers(db).run(
      `INSERT INTO employees (candidate_id, employee_code, company_email, name, joined_on, status, access_restricted, created_at)
       VALUES (?, ?, ?, ?, ?, 'ONBOARDING', ?, ?)`,
      candidateId, code, email, cand.name, joinedOn, subjectToBgv ? 1 : 0, iso(now),
    );
    const empId = Number(info.lastInsertRowid);
    for (const [key, label, owner] of DAY1_ITEMS) {
      helpers(db).run("INSERT INTO onboarding_items (employee_id, item_key, label, owner_team, kind) VALUES (?, ?, ?, ?, 'DAY1')", empId, key, label, owner);
    }
    for (const label of policy(db, 'checklists.access')) {
      helpers(db).run("INSERT INTO onboarding_items (employee_id, item_key, label, owner_team, kind) VALUES (?, ?, ?, 'IT', 'ACCESS')", empId, `access:${label}`, label);
    }
    updateCandidateFields(db, candidateId, { phase: 'ONBOARDING', status: 'Joined, onboarding' }, iso(now));
    if (relievingLater) {
      updateCandidateFields(db, candidateId, { relievingStatus: 'LATER', relievingDue: day(addDays(now, policy(db, 'joining.relievingLetterDays'))) }, iso(now));
    }
  });
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `Joined on Day 1 as ${code} (${email})${subjectToBgv ? '. Joined subject to background check: access restricted' : ''}.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'candidate.join', entity: 'candidate', entityId: candidateId, detail: { code, email } });
  return getCandidate(db, actor, candidateId);
}

export const DAY1_ITEMS = [
  ['id_card', 'ID card and access card handed over', 'ADMIN'],
  ['laptop', 'Laptop, charger and headset handed over. Serial number recorded', 'IT'],
  ['policies', 'Appointment letter, NDA, IT and code-of-conduct policies signed', 'HR'],
  ['documents', 'Original documents verified', 'HR'],
  ['hrms', 'HRMS login: payroll, PF and ESI, bank details, insurance, leave policy', 'HR'],
  ['manager', 'Met manager and buddy, team introduction, welcome kit', 'HR'],
];

export function nextEmployeeCode(db) {
  let n = helpers(db).one('SELECT COUNT(*) AS n FROM employees').n + 1001;
  while (helpers(db).one('SELECT 1 AS x FROM employees WHERE employee_code = ?', `EMP-${n}`)) n += 1;
  return `EMP-${n}`;
}

/** first.last@company, de-duplicated with a number. Non-latin names fall back to the code. */
export function uniqueCompanyEmail(db, name) {
  const domain = process.env.COMPANY_DOMAIN ?? 'company.com';
  const parts = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).map((p) => p.replace(/[^a-z]/g, '')).filter(Boolean);
  const base = parts.length ? parts.join('.') : `employee${Date.now() % 100000}`;
  let candidate = `${base}@${domain}`;
  let n = 2;
  while (helpers(db).one('SELECT 1 AS x FROM employees WHERE company_email = ?', candidate)) {
    candidate = `${base}${n}@${domain}`;
    n += 1;
  }
  return candidate;
}

export function dayOneNoShow(db, actor, candidateId, { reason }, now) {
  const cand = requireCandidate(db, actor, candidateId);
  if (cand.phase !== 'PRE_JOINING') throw rule('Day 1 no-show applies before joining.', 'wrong_phase');
  const why = (reason ?? '').trim() || 'Did not turn up on Day 1';
  helpers(db).tx(() => {
    helpers(db).run("UPDATE offers SET status = 'REVOKED', response_note = ? WHERE candidate_id = ? AND status = 'ACCEPTED'", 'No-show on Day 1', candidateId);
    cancelOpenTasks(db, candidateId);
    updateCandidateFields(db, candidateId, { stage: 'CLOSED', status: 'No-show on Day 1', closedReason: 'No-show on Day 1' }, iso(now));
  });
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `No-show on Day 1. ${why}. Email and access requests cancelled.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'candidate.day1_no_show', entity: 'candidate', entityId: candidateId });
  return getCandidate(db, actor, candidateId);
}


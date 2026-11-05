import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { rule, notFound, stale } from '../errors.js';
import { audit, auditTrail } from '../audit/index.js';
import { helpers } from '../db/index.js';
import {
  toCandidate, findCandidateRow, findDuplicates, insertCandidate, updateCandidateFields, addEvent,
  eventsFor, listCandidateRows, normPhone,
} from '../db/repo/candidates.js';
import { findRequisitionRow, loadRequisition } from '../db/repo/requisitions.js';
import { roundsForCandidate, insertRound, updateRoundFields, activeRoundSummaries } from '../db/repo/interviews.js';
import { scoreResume, screeningStatus, knockoutFlags } from '../ats/scoring.js';
import { policy } from '../policy/index.js';
import { render } from '../templates/render.js';
import { moveStage, STAGE, UNDO_MINUTES } from '../workflow/candidates.js';
import { REQ_STATUS } from '../workflow/requisitions.js';
import { addMentionReminders } from '../reminders/store.js';

const SOURCES = ['Careers page', 'LinkedIn', 'Naukri', 'Indeed', 'Employee referral', 'Recruitment agency', 'Campus drive', 'Other'];
const WHERE_CAN_SEE_SALARY = ['HR', 'ADMIN'];
const addDays = (now, days) => new Date(now.getTime() + days * 86_400_000);

// ---------- validation ----------

const Intake = z.object({
  requisitionId: z.number().int('Choose the role this person applied for.'),
  name: z.string().trim().min(2, 'Enter the candidate’s full name.'),
  email: z.string().trim().email('Enter a valid email, or leave it empty.').or(z.literal('')).optional().default(''),
  phone: z.string().trim().max(20).optional().default(''),
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}\d{4}[A-Z]|)$/, 'PAN looks like ABCDE1234F.').optional().default(''),
  location: z.string().trim().max(80).optional().default(''),
  source: z.enum(SOURCES, { errorMap: () => ({ message: 'Choose where they came from.' }) }).default('Other'),
  sourceDetail: z.string().trim().max(120).optional().default(''),
  experienceYears: z.number().min(0).max(45).optional().nullable(),
  currentCtcLpa: z.number().min(0).max(500).optional().nullable(),
  expectedCtcLpa: z.number().min(0).max(500).optional().nullable(),
  noticeDays: z.number().int().min(0).max(365).optional().nullable(),
  workAuth: z.boolean().optional().nullable(),
  shiftOk: z.boolean().optional().nullable(),
  resumeText: z.string().max(60000).optional().default(''),
  portfolioUrl: z.string().trim().max(200).refine((u) => u === '' || /^https?:\/\//i.test(u), 'Use a full address starting with http:// or https://.').optional().default(''),
  githubUrl: z.string().trim().max(200).refine((u) => u === '' || /^https?:\/\//i.test(u), 'Use a full address starting with http:// or https://.').optional().default(''),
  confirmDuplicate: z.boolean().optional().default(false),
  overrideCooling: z.boolean().optional().default(false),
}).refine((v) => v.email || normPhone(v.phone).length === 10, {
  message: 'Add an email or a 10-digit phone number, so the candidate can be contacted.',
  path: ['email'],
});

const ContactPatch = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().email('Enter a valid email.').or(z.literal('')).optional(),
  phone: z.string().trim().max(20).optional(),
  location: z.string().trim().max(80).optional(),
  portfolioUrl: z.string().trim().max(200).optional(),
  githubUrl: z.string().trim().max(200).optional(),
  resumeText: z.string().max(60000).optional(),
  experienceYears: z.number().min(0).max(45).nullable().optional(),
});

const KnockoutInput = z.object({
  currentCtcLpa: z.number().min(0).max(500).nullable().optional(),
  expectedCtcLpa: z.number().min(0).max(500).nullable().optional(),
  noticeDays: z.number().int().min(0).max(365).nullable().optional(),
  workAuth: z.boolean().nullable().optional(),
  shiftOk: z.boolean().nullable().optional(),
  location: z.string().trim().max(80).optional(),
});

// ---------- helpers ----------

function requisitionFor(db, id) {
  const r = findRequisitionRow(db, id);
  if (!r) throw notFound('That role');
  return r;
}

function candidateOr404(db, id) {
  const row = findCandidateRow(db, id);
  if (!row) throw notFound('That candidate');
  return row;
}

/** Interviewers only see candidates they are on a panel for. Others get "not found", not "forbidden". */
export function canSee(db, actor, candidateId) {
  if (actor.role !== 'INTERVIEWER') return true;
  return !!helpers(db).one(
    `SELECT 1 AS ok FROM interview_rounds ir JOIN interview_panel p ON p.interview_round_id = ir.id
      WHERE ir.candidate_id = ? AND p.user_id = ?`,
    candidateId, actor.id,
  );
}

function assertVisible(db, actor, candidateId) {
  if (!canSee(db, actor, candidateId)) throw notFound('That candidate');
}

/** Loads a candidate the actor may see, or throws. Used by every service that acts on a candidate. */
export function requireCandidate(db, actor, id) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  return row;
}

function scoringFor(db, req, input) {
  const weights = policy(db, 'ats.weights');
  const cutoffs = { shortlistAt: policy(db, 'ats.shortlistAt'), reviewAt: policy(db, 'ats.reviewAt') };
  const scored = scoreResume({
    resumeText: input.resumeText,
    mustSkills: JSON.parse(req.must_skills),
    goodSkills: JSON.parse(req.good_skills),
    experienceYears: input.experienceYears,
    expMin: req.exp_min,
    expMax: req.exp_max,
  }, weights);
  const status = screeningStatus(input.resumeText, scored.score, cutoffs);
  const flags = [
    ...scored.flags,
    ...knockoutFlags({
      expectedCtc: input.expectedCtcLpa, budgetMaxLpa: req.budget_max_lpa,
      noticeDays: input.noticeDays, noticeMaxDays: req.notice_max_days,
      workAuth: input.workAuth, shiftOk: input.shiftOk,
      location: input.location, reqLocation: req.location, remote: !!req.remote,
    }),
  ];
  return { ...scored, status, flags };
}

/** Plain next step for the person looking at a candidate. */
export function nextActionFor(c, activeRound) {
  if (c.stage === STAGE.CLOSED) return c.status === 'Talent pool' ? 'Follow up on the talent pool date' : null;
  if (c.onHold) return 'Decide how to resolve the hold';
  if (c.stage === STAGE.SCREENING) {
    if (c.status === 'Parsing failed' || c.status === 'Manual review') return 'Read the resume and decide';
    if (c.status === 'Below cut-off') return 'Confirm the rejection or undo it';
    if (c.status === 'Phone screen failed') return 'Reject, or give one more chance';
    if (c.status === 'Shortlisted for interviews') return 'Start the interview rounds';
    if (c.status === 'Shortlisted') return 'Hold the HR phone screen';
    if (c.flags?.some((f) => f.includes('needs manager approval'))) return 'Get manager approval for the notice period';
    return 'Check the knock-out questions';
  }
  if (c.stage === STAGE.INTERVIEWS) {
    if (!activeRound) return 'Review the interview plan';
    if (activeRound.status === 'TO_SCHEDULE') return `Schedule ${activeRound.name}`;
    if (activeRound.status === 'SCHEDULED') return `Wait for ${activeRound.name} feedback`;
    if (activeRound.status === 'NO_SHOW') return `Rebook ${activeRound.name}`;
    return `Decide ${activeRound.name}`;
  }
  if (c.stage === STAGE.SELECTED) return 'Prepare the offer';
  return null;
}

function summarise(row, activeRound) {
  const c = toCandidate(row);
  return {
    ...c,
    requisitionTitle: row.requisition_title,
    ownerName: row.owner_name,
    activeRound: activeRound ? { name: activeRound.name, status: activeRound.status } : null,
    nextAction: nextActionFor(c, activeRound),
  };
}

// ---------- reads ----------

export function listCandidates(db, actor, filters) {
  const viewerId = actor.role === 'INTERVIEWER' ? actor.id : null;
  const rows = listCandidateRows(db, { ...filters, viewerId });
  const rounds = activeRoundSummaries(db, rows.map((r) => r.id));
  return rows.map((r) => summarise(r, rounds.get(r.id)));
}

export function getCandidate(db, actor, id) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const req = loadRequisition(db, row.requisition_id);
  const rounds = roundsForCandidate(db, id);
  // Independent scoring: an interviewer sees other members' feedback only once everyone has submitted.
  if (actor.role === 'INTERVIEWER') {
    for (const r of rounds) {
      const done = r.panel.length > 0 && r.panel.every((p) => p.submittedAt);
      r.panel = r.panel.map((p) => (p.userId === actor.id || done ? p : { ...p, scores: null, avg: null, recommendation: null, comments: null, conflictNote: null, submittedAt: p.submittedAt ? 'submitted' : null }));
    }
  }
  const active = rounds.find((r) => !['WAITING', 'PASSED', 'SUPERSEDED', 'SELECTED'].includes(r.status));
  const base = summarise(
    { ...row, requisition_title: req.title, owner_name: row.owner_id ? helpers(db).one('SELECT name FROM users WHERE id = ?', row.owner_id)?.name : null },
    active,
  );
  const canSeeSalary = WHERE_CAN_SEE_SALARY.includes(actor.role);
  const canSeeBudget = ['HR', 'RECRUITER', 'ADMIN'].includes(actor.role);
  const salary = canSeeSalary
    ? { currentCtcLpa: row.current_ctc_lpa, expectedCtcLpa: row.expected_ctc_lpa }
    : { ctcWithinBudget: row.expected_ctc_lpa == null || req.budget_max_lpa == null ? null : row.expected_ctc_lpa <= req.budget_max_lpa };
  return {
    ...base,
    ...salary,
    requisition: { id: req.id, title: req.title, status: req.status, budgetMaxLpa: canSeeBudget ? req.budget_max_lpa : undefined, rounds: req.rounds },
    rounds,
    events: eventsFor(db, id),
    canSeeSalary,
    employeeId: helpers(db).one('SELECT id FROM employees WHERE candidate_id = ?', id)?.id ?? null,
  };
}

export function candidateHistory(db, actor, id) {
  candidateOr404(db, id);
  assertVisible(db, actor, id);
  return { events: eventsFor(db, id), audit: auditTrail(db, 'candidate', id) };
}

// ---------- intake ----------

export function createCandidate(db, actor, body, now, { parsed, via = 'HR' } = {}) {
  const input = Intake.parse(body ?? {});
  const req = requisitionFor(db, input.requisitionId);
  if (req.status !== REQ_STATUS.OPEN) {
    throw rule('Applications can only be added to an open role.', 'role_not_open');
  }
  const iso = now.toISOString();

  // Same person, applied before. A rejection inside the cooling-off period blocks the new application.
  const dupes = findDuplicates(db, input);
  const recentRejection = dupes.find((d) => d.stage === 'CLOSED' && d.rejected_at
    && (now - new Date(d.rejected_at)) / 86_400_000 < policy(db, 'reapplyCoolingDays'));
  if (recentRejection && !(input.overrideCooling && ['HR', 'ADMIN'].includes(actor.role))) {
    throw rule(
      `This person was not moved forward for ${recentRejection.requisition_title} on ${recentRejection.rejected_at.slice(0, 10)} (${recentRejection.reject_reason || 'no reason recorded'}). `
      + `They can re-apply after ${policy(db, 'reapplyCoolingDays')} days, unless HR overrides this.`,
      'cooling_off',
    );
  }
  if (dupes.length && !input.confirmDuplicate) {
    const err = rule(
      `This looks like someone already in HireTrack (${dupes[0].name}, ${dupes[0].requisition_title}). Check before adding a second record.`,
      'duplicate_warning',
    );
    err.details = { duplicates: dupes.map((d) => ({ id: d.id, name: d.name, requisitionTitle: d.requisition_title, stage: d.stage, status: d.status })) };
    throw err;
  }

  const scored = scoringFor(db, req, { ...input, resumeText: input.resumeText || parsed || '' });
  const id = insertCandidate(db, {
    ...input,
    currentCtcLpa: input.currentCtcLpa,
    expectedCtcLpa: input.expectedCtcLpa,
    resumeText: input.resumeText || parsed || '',
    status: scored.status,
    atsScore: scored.score,
    atsBreakdown: scored.breakdown,
    matchedSkills: scored.matched,
    missingSkills: scored.missing,
    flags: scored.flags,
    ownerId: actor.id,
    linkedToId: dupes[0]?.id ?? null,
  }, iso);
  helpers(db).run('UPDATE candidates SET token = ?, applied_via = ? WHERE id = ?', randomBytes(18).toString('base64url'), via, id);
  addEvent(db, id, { at: iso, userId: actor.id, text: `Applied for ${req.title}. ATS score ${scored.score}: ${scored.status}.` });
  if (dupes.length) addEvent(db, id, { at: iso, userId: actor.id, text: `Linked to an earlier record for ${dupes[0].name}.` });
  audit(db, { at: iso, userId: actor.id, action: 'candidate.create', entity: 'candidate', entityId: id, detail: { status: scored.status, score: scored.score } });

  if (scored.status === 'Below cut-off') {
    // The PDF: below 50 is rejected with a polite email. It goes through the 10-minute undo window.
    rejectCandidate(db, actor, id, 'Below the ATS cut-off', now, { auto: true });
  }
  return getCandidate(db, actor, id);
}

/** Converts a resume upload into text. Scanned files without a text layer return an empty string. */
export function resumeIntakeHint(text) {
  return (text ?? '').trim().length < 40 ? 'We could not read text from this file. It may be a scan. Paste the text instead, or send it to manual review.' : null;
}

// ---------- editing ----------

export function updateCandidate(db, actor, id, body, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const { version, ...rest } = body ?? {};
  if (typeof version !== 'number') throw rule('Reload the page and try again.', 'missing_version');
  if (row.version !== version) throw stale();
  const data = ContactPatch.parse(rest);
  const iso = now.toISOString();
  const resumeChanged = data.resumeText !== undefined && data.resumeText !== row.resume_text;
  const req = requisitionFor(db, row.requisition_id);
  const fields = { ...data };
  if (resumeChanged || data.experienceYears !== undefined) {
    const merged = { resumeText: data.resumeText ?? row.resume_text, experienceYears: data.experienceYears ?? row.experience_years,
      expectedCtcLpa: row.expected_ctc_lpa, noticeDays: row.notice_days, workAuth: row.work_auth == null ? null : !!row.work_auth,
      shiftOk: row.shift_ok == null ? null : !!row.shift_ok, location: data.location ?? row.location };
    const s = scoringFor(db, req, merged);
    Object.assign(fields, { atsScore: s.score, atsBreakdown: s.breakdown, matchedSkills: s.matched, missingSkills: s.missing, flags: s.flags });
    if (!['Shortlisted', 'Manual review', 'Below cut-off', 'Parsing failed'].includes(row.status) || row.stage === STAGE.SCREENING) {
      fields.status = s.status;
    }
  }
  updateCandidateFields(db, id, fields, iso);
  const changed = Object.keys(data).join(', ');
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'system', text: `Details updated: ${changed}${resumeChanged ? ' (resume re-scored)' : ''}.` });
  audit(db, { at: iso, userId: actor.id, action: 'candidate.update', entity: 'candidate', entityId: id, detail: { fields: Object.keys(data) } });
  return getCandidate(db, actor, id);
}

export function saveKnockouts(db, actor, id, body, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const data = KnockoutInput.parse(body ?? {});
  const req = requisitionFor(db, row.requisition_id);
  const merged = {
    expectedCtc: data.expectedCtcLpa !== undefined ? data.expectedCtcLpa : row.expected_ctc_lpa,
    budgetMaxLpa: req.budget_max_lpa,
    noticeDays: data.noticeDays !== undefined ? data.noticeDays : row.notice_days,
    noticeMaxDays: req.notice_max_days,
    workAuth: data.workAuth !== undefined ? data.workAuth : (row.work_auth == null ? null : !!row.work_auth),
    shiftOk: data.shiftOk !== undefined ? data.shiftOk : (row.shift_ok == null ? null : !!row.shift_ok),
    location: data.location ?? row.location,
    reqLocation: req.location,
    remote: !!req.remote,
  };
  const iso = now.toISOString();
  const scored = JSON.parse(row.flags || '[]').filter((f) => !/budget|Notice period|Work authorisation|Shift|relocation|Lives in/.test(f));
  const flags = [...scored, ...knockoutFlags(merged)];
  const fields = { flags, currentCtcLpa: data.currentCtcLpa, expectedCtcLpa: data.expectedCtcLpa, noticeDays: data.noticeDays,
    workAuth: data.workAuth, shiftOk: data.shiftOk, location: data.location };
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  updateCandidateFields(db, id, fields, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'system', text: 'Knock-out questions updated.' });
  return getCandidate(db, actor, id);
}

export function approveNotice(db, actor, id, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const iso = now.toISOString();
  updateCandidateFields(db, id, { noticeApprovedBy: actor.name }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: `Long notice period approved by ${actor.name}.` });
  return getCandidate(db, actor, row.id);
}

// ---------- screening decisions ----------

export function phoneScreen(db, actor, id, { outcome, notes }, now) {
  const row = candidateOr404(db, id);
  if (row.stage !== STAGE.SCREENING) throw rule('The phone screen happens during screening only.', 'wrong_stage');
  if (row.on_hold) throw rule('This candidate is on hold. Resume them before the phone screen.', 'on_hold');
  const text = (notes ?? '').trim();
  if (text.length < 3) throw rule('Add a few notes from the call: interest, communication, reason for change.', 'reason_required', { notes: 'Add a few notes from the call.' });
  const pendingNotice = JSON.parse(row.flags || '[]').some((f) => f.includes('needs manager approval')) && !row.notice_approved_by;
  if (outcome === 'PASS' && pendingNotice) {
    throw rule('The notice period is longer than allowed. Get manager approval before moving on.', 'needs_approval');
  }
  const iso = now.toISOString();
  const status = outcome === 'PASS' ? 'Shortlisted for interviews' : 'Phone screen failed';
  updateCandidateFields(db, id, { status, phoneScreenNotes: text }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'note', text: `Phone screen ${outcome === 'PASS' ? 'passed' : 'not passed'}: ${text}` });
  return getCandidate(db, actor, id);
}

export function startInterviews(db, actor, id, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const next = moveStage(row.stage, STAGE.INTERVIEWS);
  if (row.on_hold) throw rule('This candidate is on hold. Resume them before starting interviews.', 'on_hold');
  if (row.status !== 'Shortlisted for interviews' && row.status !== 'Shortlisted') {
    throw rule('Pass the phone screen before starting interviews.', 'not_shortlisted');
  }
  const req = loadRequisition(db, row.requisition_id);
  if (!req.rounds.length) throw rule('The role has no interview rounds yet. Add a hiring plan first.', 'no_plan');
  const iso = now.toISOString();
  helpers(db).tx(() => {
    req.rounds.forEach((r, i) => insertRound(db, id, r.id, i + 1, r, i === 0 ? 'TO_SCHEDULE' : 'WAITING'));
    updateCandidateFields(db, id, { stage: next, status: 'In interviews' }, iso);
  });
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'system', text: `Interview rounds started (${req.rounds.length} rounds).` });
  return getCandidate(db, actor, id);
}

/** Rejection: hidden from active lists, undoable for 10 minutes, and a polite email draft is produced. */
export function rejectCandidate(db, actor, id, reason, now, { auto = false } = {}) {
  const row = candidateOr404(db, id);
  if (row.stage === STAGE.CLOSED) throw rule('This candidate is already closed.', 'already_closed');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Choose or write a reason. It is kept with the record.', 'reason_required', { reason: 'Choose a reason.' });
  const iso = now.toISOString();
  const undoUntil = addDays(now, 0).getTime() + UNDO_MINUTES * 60_000;
  const snapshot = { stage: row.stage, status: row.status, onHold: !!row.on_hold, holdReason: row.hold_reason };
  updateCandidateFields(db, id, {
    stage: STAGE.CLOSED, status: 'Rejected', closedReason: 'Rejected', rejectReason: why, rejectedAt: iso,
    rejectUndoUntil: new Date(undoUntil).toISOString(), undoSnapshot: snapshot, onHold: false,
  }, iso);
  addEvent(db, id, { at: iso, userId: auto ? null : actor?.id ?? null, kind: 'decision', text: `Rejected: ${why}. Undo is possible for ${UNDO_MINUTES} minutes.` });
  audit(db, { at: iso, userId: actor?.id ?? null, action: 'candidate.reject', entity: 'candidate', entityId: id, reason: why, detail: { auto } });
  const r = loadRequisition(db, row.requisition_id);
  const draft = render(policy(db, 'templates.rejection'), { name: row.name.split(' ')[0], role: r.title });
  return { ...getCandidate(db, actor, id), rejectionDraft: draft, undoUntil: new Date(undoUntil).toISOString() };
}

export function rejectRoute(db, actor, id, body, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const { reason } = body ?? {};
  return rejectCandidate(db, actor, row.id, reason, now);
}

export function undoReject(db, actor, id, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  if (row.closed_reason !== 'Rejected' || !row.undo_snapshot) throw rule('This candidate is not rejected.', 'not_rejected');
  if (!row.reject_undo_until || now > new Date(row.reject_undo_until)) {
    throw rule(`The ${UNDO_MINUTES}-minute undo window has passed. Re-open the candidate from the history if you still need to.`, 'undo_expired');
  }
  const snap = JSON.parse(row.undo_snapshot);
  const iso = now.toISOString();
  updateCandidateFields(db, id, {
    stage: snap.stage, status: snap.status, onHold: snap.onHold, holdReason: snap.holdReason,
    closedReason: null, rejectReason: null, rejectedAt: null, rejectUndoUntil: null, undoSnapshot: null,
  }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: 'Rejection undone within the undo window.' });
  audit(db, { at: iso, userId: actor.id, action: 'candidate.undo_reject', entity: 'candidate', entityId: id });
  return getCandidate(db, actor, id);
}

export function withdraw(db, actor, id, { reason }, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  if (row.stage === STAGE.CLOSED) throw rule('This candidate is already closed.', 'already_closed');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Say why they withdrew, so the record is complete.', 'reason_required', { reason: 'Add a short reason.' });
  const iso = now.toISOString();
  updateCandidateFields(db, id, { stage: STAGE.CLOSED, status: 'Withdrawn', closedReason: 'Withdrawn', onHold: false }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: `Withdrew: ${why}. Interview slots released.` });
  audit(db, { at: iso, userId: actor.id, action: 'candidate.withdraw', entity: 'candidate', entityId: id, reason: why });
  return getCandidate(db, actor, id);
}

export function talentPool(db, actor, id, { followUpDate, reason }, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  if (row.stage === STAGE.CLOSED) throw rule('This candidate is already closed.', 'already_closed');
  const days = policy(db, 'talentPoolFollowUpDays');
  const earliest = addDays(now, 30).toISOString().slice(0, 10);
  const latest = addDays(now, days).toISOString().slice(0, 10);
  const date = followUpDate || addDays(now, days).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw rule('Pick a follow-up date.', 'bad_date', { followUpDate: 'Pick a date.' });
  if (date < earliest || date > latest) {
    throw rule(`Follow-up must be between 30 days and ${days} days from today.`, 'bad_date', { followUpDate: `Pick a date between ${earliest} and ${latest}.` });
  }
  const iso = now.toISOString();
  updateCandidateFields(db, id, { stage: STAGE.CLOSED, status: 'Talent pool', closedReason: 'Talent pool', followUpDate: date, onHold: false }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: `Moved to the talent pool. Follow up on ${date}.${reason ? ` ${reason}` : ''}` });
  return getCandidate(db, actor, id);
}

export function setHold(db, actor, id, { onHold, reason }, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  if (row.stage === STAGE.CLOSED) throw rule('Closed candidates cannot be put on hold.', 'already_closed');
  const iso = now.toISOString();
  if (onHold) {
    const why = (reason ?? '').trim();
    if (why.length < 3) throw rule('Say why the candidate is on hold.', 'reason_required', { reason: 'Add a short reason.' });
    updateCandidateFields(db, id, { onHold: true, holdReason: why }, iso);
    addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: `Put on hold: ${why}` });
  } else {
    updateCandidateFields(db, id, { onHold: false, holdReason: null }, iso);
    addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: 'Hold removed.' });
  }
  return getCandidate(db, actor, id);
}

export function assignOwner(db, actor, id, ownerId, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const owner = helpers(db).one("SELECT id, name FROM users WHERE id = ? AND active = 1 AND role IN ('HR','RECRUITER','ADMIN')", ownerId);
  if (!owner) throw rule('Choose an active recruiter or HR person.', 'bad_owner', { ownerId: 'Choose a recruiter.' });
  const iso = now.toISOString();
  updateCandidateFields(db, id, { ownerId: owner.id }, iso);
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'system', text: `Now owned by ${owner.name}.` });
  return getCandidate(db, actor, row.id);
}

export function addNote(db, actor, id, { text }, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  const clean = (text ?? '').trim();
  if (!clean) throw rule('Write the note first.', 'empty_note', { text: 'Write something first.' });
  const iso = now.toISOString();
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'note', text: clean });
  addMentionReminders(db, { text: clean, candidateId: id, candidateName: row.name, byName: actor.name, at: iso });
  return getCandidate(db, actor, id);
}

/** Moves a candidate to another open role. Their feedback is kept; interview rounds are rebuilt for the new plan. */
export function moveJob(db, actor, id, { requisitionId, reason }, now) {
  const row = candidateOr404(db, id);
  assertVisible(db, actor, id);
  if (row.stage === STAGE.CLOSED) throw rule('Re-open the candidate before moving them.', 'already_closed');
  const target = requisitionFor(db, requisitionId);
  if (target.status !== REQ_STATUS.OPEN) throw rule('Choose a role that is open.', 'role_not_open');
  if (requisitionId === row.requisition_id) throw rule('They are already on this role.', 'same_role');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Say why they are moving, for example "stronger fit for SDE-3".', 'reason_required', { reason: 'Add a short reason.' });
  const iso = now.toISOString();
  const fromTitle = requisitionFor(db, row.requisition_id).title;
  helpers(db).tx(() => {
    for (const r of roundsForCandidate(db, id)) {
      if (r.status !== 'SUPERSEDED') updateRoundFields(db, r.id, { status: 'SUPERSEDED' });
    }
    updateCandidateFields(db, id, { requisitionId, status: 'Moved to another role', onHold: false }, iso);
    if (row.stage === STAGE.INTERVIEWS) {
      const req = loadRequisition(db, requisitionId);
      req.rounds.forEach((r, i) => insertRound(db, id, r.id, i + 1, r, i === 0 ? 'TO_SCHEDULE' : 'WAITING'));
    }
  });
  addEvent(db, id, { at: iso, userId: actor.id, kind: 'decision', text: `Moved from ${fromTitle} to ${target.title}: ${why}. Feedback kept.` });
  audit(db, { at: iso, userId: actor.id, action: 'candidate.move_job', entity: 'candidate', entityId: id, reason: why, detail: { to: requisitionId } });
  return getCandidate(db, actor, id);
}

/** Bulk reject: each person still gets their own 10-minute undo. */
export function bulkReject(db, actor, { ids, reason }, now) {
  if (!ids?.length) throw rule('Select at least one candidate.', 'nothing_selected');
  const results = ids.map((id) => {
    try {
      rejectCandidate(db, actor, id, reason, now);
      return { id, ok: true };
    } catch (e) {
      return { id, ok: false, error: e.message };
    }
  });
  return { results, done: results.filter((r) => r.ok).length };
}

export function bulkAssign(db, actor, { ids, ownerId }, now) {
  if (!ids?.length) throw rule('Select at least one candidate.', 'nothing_selected');
  const results = ids.map((id) => {
    try {
      assignOwner(db, actor, id, ownerId, now);
      return { id, ok: true };
    } catch (e) {
      return { id, ok: false, error: e.message };
    }
  });
  return { results, done: results.filter((r) => r.ok).length };
}

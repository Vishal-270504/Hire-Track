import { z } from 'zod';
import { rule, notFound, stale, forbidden } from '../errors.js';
import { audit } from '../audit/index.js';
import { helpers } from '../db/index.js';
import {
  loadRequisition, findRequisitionRow, insertRequisition, updateRequisitionFields, deleteRequisition,
  replaceApprovals, findApproval, setApprovalDecision, approvalsFor, insertRound, updateRound, deleteRound,
  roundIdsFor, findRound,
} from '../db/repo/requisitions.js';
import { moveTo, CORE_EDITABLE, PLAN_EDITABLE, REQ_STATUS, LABEL } from '../workflow/requisitions.js';
import { findTemplate } from '../policy/templates.js';

// ---------- validation ----------

const skillList = z.array(z.string().trim().min(1).max(200)).max(40).default([]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.');

export const RequisitionBase = z.object({
  title: z.string().trim().min(3, 'Give the role a title, for example "Java Developer".'),
  level: z.string().trim().max(60).optional().nullable(),
  headcount: z.number().int().min(1, 'At least one person is needed.').max(50).default(1),
  team: z.string().trim().max(80).optional().nullable(),
  location: z.string().trim().max(80).optional().nullable(),
  remote: z.boolean().default(false),
  budgetMaxLpa: z.number().positive('Enter the most you can pay, in lakhs per year.').max(500).optional().nullable(),
  targetJoinDate: isoDate.optional().nullable(),
  jdText: z.string().max(10000).default(''),
  mustSkills: skillList,
  goodSkills: skillList,
  expMin: z.number().min(0).max(40).optional().nullable(),
  expMax: z.number().min(0).max(40).optional().nullable(),
  noticeMaxDays: z.number().int().min(0).max(365).optional().nullable(),
});

const experienceInOrder = (v) => v.expMin == null || v.expMax == null || v.expMin <= v.expMax;
const EXPERIENCE_MSG = { message: 'The minimum experience cannot be more than the maximum.', path: ['expMax'] };
export const RequisitionInput = RequisitionBase.refine(experienceInOrder, EXPERIENCE_MSG);

export const RoundInput = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(2, 'Give the round a name.').max(80),
  type: z.enum(['ONLINE_TEST', 'TAKE_HOME', 'SCORECARD', 'DECISION', 'FINAL_APPROVAL'], {
    errorMap: () => ({ message: 'Choose what kind of round this is.' }),
  }),
  durationMin: z.number().int().min(5).max(480).nullable().optional(),
  format: z.string().trim().max(160).default(''),
  who: z.string().trim().max(120).default(''),
  passPercent: z.number().min(0).max(100).nullable().optional(),
  passAverage: z.number().min(1).max(5).nullable().optional(),
  skills: skillList,
  optional: z.boolean().default(false),
}).superRefine((r, ctx) => {
  if (r.type === 'ONLINE_TEST' && r.passPercent == null) {
    ctx.addIssue({ code: 'custom', path: ['passPercent'], message: 'Set the pass mark as a percentage, for example 60.' });
  }
  if ((r.type === 'SCORECARD' || r.type === 'TAKE_HOME') && r.passAverage == null) {
    ctx.addIssue({ code: 'custom', path: ['passAverage'], message: 'Set the pass average on a 1 to 5 scale, for example 3.' });
  }
});

export const PlanInput = z.object({
  version: z.number().int(),
  rounds: z.array(RoundInput).min(1, 'Add at least one round.').max(12, 'Keep the plan to 12 rounds or fewer.'),
});

/** Plan rules that span several rounds. */
function checkPlan(rounds) {
  const names = rounds.map((r) => r.name.toLowerCase());
  if (new Set(names).size !== names.length) throw rule('Two rounds have the same name. Give each round its own name.', 'duplicate_round');
  const finals = rounds.map((r, i) => ({ r, i })).filter(({ r }) => r.type === 'FINAL_APPROVAL');
  if (finals.length > 1) throw rule('Only one round can be the final approval.', 'plan_rule');
  if (finals.length === 1 && finals[0].i !== rounds.length - 1) {
    throw rule('The final approval must be the last round.', 'plan_rule');
  }
}

// ---------- reads ----------

export function getRequisition(db, id) {
  const req = loadRequisition(db, id);
  if (!req) throw notFound('That requisition');
  return req;
}

// ---------- writes ----------

export function createRequisition(db, actor, body, now) {
  const data = RequisitionInput.parse(body);
  const iso = now.toISOString();
  const id = insertRequisition(db, data, actor.id, iso);
  audit(db, { at: iso, userId: actor.id, action: 'requisition.create', entity: 'requisition', entityId: id });
  return getRequisition(db, id);
}

export function updateRequisition(db, actor, id, body, now) {
  const current = findRequisitionRow(db, id);
  if (!current) throw notFound('That requisition');
  const { version, ...rest } = body ?? {};
  if (typeof version !== 'number') throw rule('Reload the page and try again.', 'missing_version');
  const data = RequisitionBase.partial().parse(rest);
  if (!experienceInOrder(data)) throw rule(EXPERIENCE_MSG.message, 'bad_range', { expMax: EXPERIENCE_MSG.message });
  if (!CORE_EDITABLE.includes(current.status)) {
    throw rule(
      `This role is ${LABEL[current.status].toLowerCase()}, so its details are locked. Hold or close it to make changes, or raise a new requisition.`,
      'locked',
    );
  }
  if (current.version !== version) throw stale();
  updateRequisitionFields(db, id, data, now.toISOString());
  audit(db, {
    at: now.toISOString(), userId: actor.id, action: 'requisition.update', entity: 'requisition', entityId: id,
    detail: { fields: Object.keys(data) },
  });
  return getRequisition(db, id);
}

export function deleteDraft(db, actor, id, now) {
  const current = findRequisitionRow(db, id);
  if (!current) throw notFound('That requisition');
  if (current.status !== REQ_STATUS.DRAFT) throw rule('Only a draft can be deleted. Close other requisitions instead.', 'not_draft');
  audit(db, { at: now.toISOString(), userId: actor.id, action: 'requisition.delete', entity: 'requisition', entityId: id });
  deleteRequisition(db, id);
}

/**
 * Saves the whole hiring plan in one go. Existing rounds keep their ids (so later
 * interview records stay attached); rounds dropped from the list are removed.
 */
export function savePlan(db, actor, id, body, now) {
  const current = findRequisitionRow(db, id);
  if (!current) throw notFound('That requisition');
  if (!PLAN_EDITABLE.includes(current.status)) {
    throw rule('This requisition is closed, so its hiring plan cannot change.', 'locked');
  }
  const { version, rounds } = PlanInput.parse(body ?? {});
  if (current.version !== version) throw stale();
  checkPlan(rounds);

  const iso = now.toISOString();
  helpers(db).tx(() => {
    const keep = new Set(rounds.filter((r) => r.id).map((r) => r.id));
    for (const rid of roundIdsFor(db, id)) {
      if (keep.has(rid)) continue;
      const used = helpers(db).one('SELECT COUNT(*) AS n FROM interview_rounds WHERE hiring_round_id = ?', rid).n;
      if (used) throw rule('A round you removed already has candidates in it. Keep the round, or move those candidates first.', 'round_in_use');
      deleteRound(db, rid);
    }
    rounds.forEach((r, i) => {
      if (r.id) {
        if (!findRound(db, r.id) || findRound(db, r.id).requisition_id !== id) throw notFound('That round');
        updateRound(db, r.id, i + 1, r);
      } else {
        insertRound(db, id, i + 1, r);
      }
    });
    updateRequisitionFields(db, id, {}, iso);
  });
  audit(db, {
    at: iso, userId: actor.id, action: 'requisition.plan', entity: 'requisition', entityId: id,
    detail: { rounds: rounds.map((r) => `${r.name} (${r.type})`) },
  });
  return getRequisition(db, id);
}

export function applyTemplate(db, actor, id, templateId, now) {
  const template = findTemplate(templateId);
  if (!template) throw notFound('That plan template');
  const current = findRequisitionRow(db, id);
  if (!current) throw notFound('That requisition');
  const rounds = template.rounds.map((r) => ({ ...r, id: undefined }));
  // Keep the same rounds where names match, so nothing is lost when a template is swapped in.
  const existing = getRequisition(db, id).rounds;
  const merged = rounds.map((r) => {
    const match = existing.find((e) => e.name.toLowerCase() === r.name.toLowerCase());
    return match ? { ...r, id: match.id } : r;
  });
  return savePlan(db, actor, id, { version: current.version, rounds: merged }, now);
}

export function copyPlan(db, actor, id, fromId, now) {
  const source = findRequisitionRow(db, fromId);
  if (!source) throw notFound('The requisition to copy from');
  const current = findRequisitionRow(db, id);
  if (!current) throw notFound('That requisition');
  const rounds = getRequisition(db, fromId).rounds.map(({ id: _id, position: _p, ...r }) => r);
  audit(db, { at: now.toISOString(), userId: actor.id, action: 'requisition.copy_plan', entity: 'requisition', entityId: id, detail: { fromId } });
  return savePlan(db, actor, id, { version: current.version, rounds }, now);
}

/** Sends a draft for approval with the chosen approvers, in order. */
export function submitForApproval(db, actor, id, approvers, now) {
  const req = findRequisitionRow(db, id);
  if (!req) throw notFound('That requisition');
  moveTo(req.status, REQ_STATUS.PENDING_APPROVAL);

  const missing = [];
  if (!req.must_skills || JSON.parse(req.must_skills).length === 0) missing.push('Add at least one must-have skill.');
  if (!req.budget_max_lpa) missing.push('Set the budget.');
  if (!req.target_join_date) missing.push('Set the target joining date.');
  const rounds = roundIdsFor(db, id);
  if (rounds.length === 0) missing.push('Add a hiring plan with at least one round.');
  if (missing.length) throw rule(`Before sending for approval: ${missing.join(' ')}`, 'incomplete');

  if (!Array.isArray(approvers) || approvers.length === 0) {
    throw rule('Choose at least one person to approve this role.', 'no_approvers', { approvers: 'Choose who approves.' });
  }
  const eligible = new Set(helpers(db).all("SELECT id FROM users WHERE active = 1 AND role IN ('HR','RECRUITER','ADMIN')").map((r) => r.id));
  const steps = approvers.map((a) => {
    if (!a || typeof a.label !== 'string' || !a.label.trim()) throw rule('Each approval step needs a label, such as "Finance".', 'bad_step');
    if (!eligible.has(Number(a.approverId))) throw rule('Choose an active HR, recruiter or admin account as approver.', 'bad_approver');
    return { label: a.label.trim(), approverId: Number(a.approverId) };
  });

  const iso = now.toISOString();
  helpers(db).tx(() => {
    replaceApprovals(db, id, steps);
    updateRequisitionFields(db, id, { status: REQ_STATUS.PENDING_APPROVAL, statusReason: null }, iso);
  });
  audit(db, {
    at: iso, userId: actor.id, action: 'requisition.submit', entity: 'requisition', entityId: id,
    detail: { approvers: steps.map((s) => s.label) },
  });
  return getRequisition(db, id);
}

/**
 * An approver decides their step. Steps are in order: a later step waits for the earlier ones.
 * Only the named approver (or an admin, who can always step in) may decide.
 */
export function decideApproval(db, actor, reqId, stepId, { decision, comment }, now) {
  const req = findRequisitionRow(db, reqId);
  if (!req) throw notFound('That requisition');
  if (req.status !== REQ_STATUS.PENDING_APPROVAL) {
    throw rule('This requisition is not waiting for approval.', 'not_pending');
  }
  const step = findApproval(db, reqId, stepId);
  if (!step) throw notFound('That approval step');
  if (step.status !== 'PENDING') throw rule('This step has already been decided.', 'already_decided');
  if (step.approver_id !== actor.id && actor.role !== 'ADMIN') {
    throw forbidden(`Only ${approverName(db, step.approver_id)} can decide this step.`);
  }
  const earlierPending = approvalsFor(db, reqId).find((a) => a.position < step.position && a.status !== 'APPROVED');
  if (earlierPending) throw rule(`Wait for "${earlierPending.label}" to approve first.`, 'out_of_order');

  const iso = now.toISOString();
  if (decision === 'REJECT') {
    const why = (comment ?? '').trim();
    if (why.length < 3) throw rule('Say why you are not approving, so the recruiter knows what to change.', 'reason_required', { comment: 'Add a short reason.' });
    helpers(db).tx(() => {
      setApprovalDecision(db, stepId, 'REJECTED', why, iso);
      updateRequisitionFields(db, reqId, { status: REQ_STATUS.REJECTED, statusReason: `${step.label}: ${why}` }, iso);
    });
    audit(db, { at: iso, userId: actor.id, action: 'requisition.reject', entity: 'requisition', entityId: reqId, reason: why });
  } else if (decision === 'APPROVE') {
    const isLast = approvalsFor(db, reqId).every((a) => a.id === stepId || a.status === 'APPROVED');
    helpers(db).tx(() => {
      setApprovalDecision(db, stepId, 'APPROVED', (comment ?? '').trim() || null, iso);
      if (isLast) updateRequisitionFields(db, reqId, { status: moveTo(REQ_STATUS.PENDING_APPROVAL, REQ_STATUS.OPEN) }, iso);
    });
    audit(db, { at: iso, userId: actor.id, action: 'requisition.approve', entity: 'requisition', entityId: reqId, detail: { step: step.label, opened: isLast } });
  } else {
    throw rule('Choose approve or not approve.', 'bad_decision');
  }
  return getRequisition(db, reqId);
}

function approverName(db, id) {
  return helpers(db).one('SELECT name FROM users WHERE id = ?', id)?.name ?? 'the named approver';
}

/** Hold, reopen or close. Each needs a reason, and only legal moves are allowed. */
export function changeStatus(db, actor, id, to, reason, now) {
  const req = findRequisitionRow(db, id);
  if (!req) throw notFound('That requisition');
  const next = moveTo(req.status, to);
  const text = (reason ?? '').trim();
  if (to !== REQ_STATUS.OPEN && text.length < 3) {
    throw rule(`Say why in a few words: ${to === REQ_STATUS.ON_HOLD ? 'why is this on hold?' : 'why is this closing?'}`, 'reason_required', { reason: 'Add a short reason.' });
  }
  const iso = now.toISOString();
  updateRequisitionFields(db, id, { status: next, statusReason: to === REQ_STATUS.OPEN ? null : text }, iso);
  // A frozen role puts its candidates on hold; reopening releases only the holds it caused.
  if (to === REQ_STATUS.ON_HOLD) {
    helpers(db).run("UPDATE candidates SET on_hold = 1, hold_reason = 'Role on hold' WHERE requisition_id = ? AND stage != 'CLOSED'", id);
  } else if (to === REQ_STATUS.OPEN) {
    helpers(db).run("UPDATE candidates SET on_hold = 0, hold_reason = NULL WHERE requisition_id = ? AND hold_reason = 'Role on hold'", id);
  }
  audit(db, {
    at: iso, userId: actor.id, action: `requisition.${to.toLowerCase()}`, entity: 'requisition', entityId: id,
    reason: to === REQ_STATUS.OPEN ? null : text, detail: { from: req.status, to: next },
  });
  return getRequisition(db, id);
}

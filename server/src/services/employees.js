import { z } from 'zod';
import { rule, notFound, forbidden } from '../errors.js';
import { audit } from '../audit/index.js';
import { helpers } from '../db/index.js';
import { updateCandidateFields, addEvent } from '../db/repo/candidates.js';
import { policy } from '../policy/index.js';
import { render } from '../templates/render.js';
import { requireCandidate, getCandidate } from './candidates.js';

const iso = (d) => d.toISOString();
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const round2 = (n) => Math.round(n * 100) / 100;

const ITEM_TEAM = { HR: ['HR', 'ADMIN'], IT: ['IT', 'ADMIN'], ADMIN: ['ADMIN', 'HR'] };

const employeeOr404 = (db, id) => {
  const e = helpers(db).one('SELECT * FROM employees WHERE id = ?', id);
  if (!e) throw notFound('That employee');
  requireCandidate(db, { role: 'ADMIN', id: 0 }, e.candidate_id); // existence and state; visibility is role-gated by routes
  return e;
};

export function outcomeFor(score) {
  if (score >= 4) return 'Exceeds';
  if (score >= 3) return 'Meets';
  if (score >= 2.5) return 'Needs improvement';
  return 'Not meeting';
}

/** Weighted score: sum of (weight x score) / 100, using the policy criteria. */
export function weightedScore(db, scores) {
  const criteria = policy(db, 'probation.criteria');
  const names = criteria.map((c) => c.name);
  const bad = names.filter((n) => !Number.isInteger(scores?.[n]) || scores[n] < 1 || scores[n] > 5);
  if (bad.length) throw rule(`Score each criterion from 1 to 5: ${bad.join(', ')}.`, 'bad_scores', { scores: `Score: ${bad.join(', ')}.` });
  return round2(criteria.reduce((s, c) => s + (c.weight * scores[c.name]) / 100, 0));
}

// ---------- reads ----------

export function employeeDetail(db, actor, id) {
  const e = helpers(db).one('SELECT * FROM employees WHERE id = ?', id);
  if (!e) throw notFound('That employee');
  const { all, one } = helpers(db);
  const today = new Date();
  return {
    id: e.id,
    candidateId: e.candidate_id,
    employeeCode: e.employee_code,
    companyEmail: e.company_email,
    name: e.name,
    joinedOn: e.joined_on,
    probationStart: e.probation_start,
    probationEnd: e.probation_end,
    status: e.status,
    displayStatus: displayStatus(db, e),
    accessRestricted: !!e.access_restricted,
    extended: !!e.extended,
    separatedOn: e.separated_on,
    separationReason: e.separation_reason,
    rehireEligible: e.rehire_eligible == null ? null : !!e.rehire_eligible,
    daysLeft: e.probation_end ? Math.ceil((new Date(`${e.probation_end}T00:00:00Z`) - today) / 86_400_000) : null,
    onboarding: all('SELECT id, item_key AS itemKey, label, owner_team AS ownerTeam, kind, done, done_at AS doneAt FROM onboarding_items WHERE employee_id = ? ORDER BY id', id),
    assets: all('SELECT id, asset_type AS assetType, serial, loaner, issued_at AS issuedAt, returned_at AS returnedAt FROM assets WHERE employee_id = ? ORDER BY id', id),
    reviews: all('SELECT id, period, scores, self_scores AS selfScores, weighted, outcome, lead_comments AS leadComments, buddy_comments AS buddyComments, status, submitted_by AS submittedBy, approved_by AS approvedBy, submitted_at AS submittedAt FROM reviews WHERE employee_id = ? ORDER BY id', id)
      .map((r) => ({ ...r, scores: JSON.parse(r.scores), selfScores: r.selfScores ? JSON.parse(r.selfScores) : null })),
    pips: all('SELECT id, months, goals, start_on AS startOn, end_on AS endOn, status, reason FROM pips WHERE employee_id = ? ORDER BY id DESC', id)
      .map((p) => ({ ...p, goals: JSON.parse(p.goals), checkins: all('SELECT at, note FROM pip_checkins WHERE pip_id = ? ORDER BY at DESC', p.id) })),
    goals: all('SELECT id, period, text, due_on AS dueOn FROM goals WHERE employee_id = ? ORDER BY id', id),
    surveys: all('SELECT id, day, rating, comment, recorded_at AS recordedAt FROM surveys WHERE employee_id = ? ORDER BY day', id),
    nextReview: nextReview(db, e, one, all),
    letters: ['confirmation', 'termination'],
  };
}

function displayStatus(db, e) {
  if (e.status === 'SEPARATED') return 'Separated';
  if (e.status === 'CONFIRMED') return 'Confirmed';
  if (e.status === 'ONBOARDING') return 'Onboarding';
  const pip = helpers(db).one("SELECT id FROM pips WHERE employee_id = ? AND status = 'ACTIVE'", e.id);
  if (pip) return 'Needs improvement (PIP)';
  if (e.extended) return 'Extended';
  return 'On track';
}

/** The next review that is due, from the joining date, plus whether it is late. */
function nextReview(db, e, one, all) {
  if (!e.probation_start) return null;
  const done = new Set(all('SELECT period FROM reviews WHERE employee_id = ?', e.id).map((r) => r.period));
  const joined = new Date(`${e.joined_on}T00:00:00Z`);
  const warnDays = policy(db, 'probation.reviewWarningDays');
  const today = day(new Date());
  for (const period of policy(db, 'probation.reviewPeriods')) {
    if (done.has(period)) continue;
    const due = period === 'FINAL' ? e.probation_end : day(addDays(joined, Number(period)));
    return { period, due, late: due < today, warn: due <= day(addDays(new Date(), warnDays)) };
  }
  return null;
}

/** Probation tracker: one row per employee with days left, next review, latest score and trend. */
export function probationTracker(db) {
  const rows = helpers(db).all("SELECT * FROM employees WHERE status IN ('ONBOARDING','PROBATION') ORDER BY probation_end, id");
  return rows.map((e) => {
    const detail = employeeDetail(db, null, e.id);
    const trend = detail.reviews.map((r) => ({ period: r.period, weighted: r.weighted }));
    return {
      id: e.id, name: e.name, employeeCode: e.employee_code, joinedOn: e.joined_on, probationEnd: e.probation_end,
      daysLeft: detail.daysLeft, status: detail.displayStatus, nextReview: detail.nextReview,
      latest: trend.length ? trend[trend.length - 1].weighted : null, trend,
    };
  });
}

// ---------- onboarding ----------

export function setOnboardingItem(db, actor, empId, { itemKey, done }, now) {
  const e = employeeOr404(db, empId);
  const item = helpers(db).one('SELECT * FROM onboarding_items WHERE employee_id = ? AND item_key = ?', empId, itemKey);
  if (!item) throw notFound('That checklist item');
  if (!ITEM_TEAM[item.owner_team].includes(actor.role)) throw forbidden(`This item belongs to the ${item.owner_team} team.`);
  helpers(db).run('UPDATE onboarding_items SET done = ?, done_at = ?, done_by = ? WHERE id = ?', done ? 1 : 0, done ? iso(now) : null, done ? actor.id : null, item.id);
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'system', text: `${done ? 'Done' : 'Reopened'}: ${item.label}.` });
  maybeStartProbation(db, e, now);
  return employeeDetail(db, actor, empId);
}

export function recordAsset(db, actor, empId, { assetType, serial, loaner }, now) {
  const e = employeeOr404(db, empId);
  if (!['LAPTOP', 'ID_CARD', 'HEADSET', 'ACCESS_CARD'].includes(assetType)) throw rule('Choose the type of asset.', 'bad_asset', { assetType: 'Choose an asset type.' });
  if (assetType === 'LAPTOP' && !(serial ?? '').trim() && !loaner) {
    throw rule('Record the laptop serial number, or mark it as a loaner.', 'serial_required', { serial: 'Enter the serial number.' });
  }
  helpers(db).run('INSERT INTO assets (employee_id, asset_type, serial, loaner, issued_at) VALUES (?, ?, ?, ?, ?)',
    empId, assetType, (serial ?? '').trim(), loaner ? 1 : 0, iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'system', text: `${assetType.replace('_', ' ').toLowerCase()} issued${serial ? ` (serial ${serial})` : ''}${loaner ? ' as a loaner' : ''}.` });
  return employeeDetail(db, actor, empId);
}

export function returnAsset(db, actor, assetId, now) {
  const a = helpers(db).one('SELECT * FROM assets WHERE id = ?', assetId);
  if (!a) throw notFound('That asset');
  helpers(db).run('UPDATE assets SET returned_at = ? WHERE id = ?', iso(now), assetId);
  const e = helpers(db).one('SELECT candidate_id FROM employees WHERE id = ?', a.employee_id);
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'system', text: `${a.asset_type.replace('_', ' ').toLowerCase()} returned.` });
  return employeeDetail(db, actor, a.employee_id);
}

/** When every access item is live, the employee moves to probation automatically. */
export function maybeStartProbation(db, e, now) {
  if (e.status !== 'ONBOARDING') return false;
  const open = helpers(db).one("SELECT COUNT(*) AS n FROM onboarding_items WHERE employee_id = ? AND kind = 'ACCESS' AND done = 0", e.id).n;
  if (open > 0) return false;
  const months = policy(db, 'probation.months');
  const start = e.joined_on;
  const end = day(addMonths(new Date(`${e.joined_on}T00:00:00Z`), months));
  helpers(db).run("UPDATE employees SET status = 'PROBATION', probation_start = ?, probation_end = ? WHERE id = ?", start, end, e.id);
  updateCandidateFields(db, e.candidate_id, { phase: 'PROBATION', status: 'On probation' }, iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: null, kind: 'decision', text: `All access is live. Probation started, ends ${end}.` });
  return true;
}

// ---------- reviews ----------

const ReviewInput = z.object({
  period: z.enum(['30', '60', '90', 'FINAL'], { errorMap: () => ({ message: 'Choose the review period.' }) }),
  scores: z.record(z.string(), z.number()),
  selfScores: z.record(z.string(), z.number()).optional(),
  leadComments: z.string().max(2000).optional(),
  buddyComments: z.string().max(2000).optional(),
});

export function submitReview(db, actor, empId, body, now) {
  const e = employeeOr404(db, empId);
  if (!['PROBATION'].includes(e.status)) throw rule('Reviews are only recorded during probation.', 'wrong_status');
  const input = ReviewInput.parse(body ?? {});
  const periods = policy(db, 'probation.reviewPeriods');
  const done = new Set(helpers(db).all('SELECT period FROM reviews WHERE employee_id = ?', empId).map((r) => r.period));
  const next = periods.find((p) => !done.has(p));
  if (input.period !== next) throw rule(`The next review is ${next === 'FINAL' ? 'the final review' : `the ${next}-day review`}.`, 'out_of_order');
  const weighted = weightedScore(db, input.scores);
  const outcome = outcomeFor(weighted);
  const iso_ = iso(now);
  helpers(db).run(
    `INSERT INTO reviews (employee_id, period, scores, self_scores, weighted, outcome, lead_comments, buddy_comments, status, submitted_by, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)`,
    empId, input.period, JSON.stringify(input.scores), input.selfScores ? JSON.stringify(input.selfScores) : null,
    weighted, outcome, input.leadComments ?? '', input.buddyComments ?? '', actor.name, iso_,
  );
  addEvent(db, e.candidate_id, { at: iso_, userId: actor.id, kind: 'decision', text: `${input.period === 'FINAL' ? 'Final' : `${input.period}-day`} review: ${weighted} (${outcome}).` });
  // Below the PIP mark in an early review: the plan starts right away, so there is time to improve.
  if (input.period !== 'FINAL' && weighted < policy(db, 'probation.pipAt')) {
    const weak = policy(db, 'probation.criteria').filter((c) => input.scores[c.name] < 3).map((c) => `Improve ${c.name.toLowerCase()} to at least 3 of 5`);
    startPip(db, actor, e, { months: policy(db, 'probation.pipMonths')[0], goals: weak.length ? weak : ['Agree a plan with the manager'] }, now, 'Early review below the improvement mark');
  }
  audit(db, { at: iso_, userId: actor.id, action: 'review.submit', entity: 'employee', entityId: empId, detail: { period: input.period, weighted } });
  return employeeDetail(db, actor, empId);
}

/** The final review must be checked by someone other than the person who wrote it. */
export function approveReview(db, actor, empId, period, now) {
  const e = employeeOr404(db, empId);
  const r = helpers(db).one('SELECT * FROM reviews WHERE employee_id = ? AND period = ?', empId, period);
  if (!r) throw notFound('That review');
  if (r.status === 'APPROVED') throw rule('This review is already approved.', 'already');
  if (r.submitted_by === actor.name) throw rule('Ask someone else to approve this review.', 'self_approval');
  helpers(db).run("UPDATE reviews SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ?", actor.name, iso(now), r.id);
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `${period === 'FINAL' ? 'Final' : `${period}-day`} review approved by ${actor.name}.` });
  return employeeDetail(db, actor, empId);
}

function activePip(db, empId) {
  return helpers(db).one("SELECT * FROM pips WHERE employee_id = ? AND status = 'ACTIVE'", empId);
}

export function startPip(db, actor, e, { months, goals, }, now, reason = 'Manager-set improvement plan') {
  if (activePip(db, e.id)) throw rule('There is already an active improvement plan.', 'pip_active');
  const allowed = policy(db, 'probation.pipMonths');
  if (!allowed.includes(months) && !(months >= allowed[0] && months <= allowed[allowed.length - 1])) {
    throw rule(`An improvement plan runs for ${allowed[0]} to ${allowed[allowed.length - 1]} months.`, 'pip_length', { months: 'Choose a length in months.' });
  }
  const goalList = (goals ?? []).map((g) => String(g).trim()).filter(Boolean);
  if (!goalList.length) throw rule('Write at least one goal for the plan.', 'no_goals', { goals: 'Add a goal.' });
  const end = day(addMonths(now, months));
  helpers(db).run("INSERT INTO pips (employee_id, months, goals, start_on, end_on, status, reason) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)",
    e.id, months, JSON.stringify(goalList), day(now), end, reason);
  updateCandidateFields(db, e.candidate_id, { status: 'Needs improvement (PIP)' }, iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor?.id ?? null, kind: 'decision', text: `Improvement plan started for ${months} month${months > 1 ? 's' : ''}, until ${end}.` });
  return end;
}

export function startPipRoute(db, actor, empId, body, now) {
  const e = employeeOr404(db, empId);
  if (!['PROBATION'].includes(e.status)) throw rule('An improvement plan is only for employees on probation.', 'wrong_status');
  startPip(db, actor, e, { months: Number(body?.months), goals: body?.goals }, now);
  audit(db, { at: iso(now), userId: actor.id, action: 'pip.start', entity: 'employee', entityId: empId });
  return employeeDetail(db, actor, empId);
}

export function pipCheckin(db, actor, pipId, { note }, now) {
  const p = helpers(db).one('SELECT * FROM pips WHERE id = ?', pipId);
  if (!p) throw notFound('That plan');
  if (p.status !== 'ACTIVE') throw rule('This plan is closed.', 'closed');
  const text = (note ?? '').trim();
  if (text.length < 3) throw rule('Write what was discussed.', 'empty_note', { note: 'Write a line.' });
  helpers(db).run('INSERT INTO pip_checkins (pip_id, at, user_id, note) VALUES (?, ?, ?, ?)', pipId, iso(now), actor.id, text);
  return employeeDetail(db, actor, p.employee_id);
}

export function closePip(db, actor, pipId, { result, reason }, now) {
  const p = helpers(db).one('SELECT * FROM pips WHERE id = ?', pipId);
  if (!p) throw notFound('That plan');
  if (p.status !== 'ACTIVE') throw rule('This plan is already closed.', 'closed');
  if (!['PASSED', 'FAILED'].includes(result)) throw rule('Choose passed or not passed.', 'bad_result');
  helpers(db).run('UPDATE pips SET status = ?, reason = ? WHERE id = ?', result, (reason ?? '').trim() || null, pipId);
  const e = helpers(db).one('SELECT * FROM employees WHERE id = ?', p.employee_id);
  updateCandidateFields(db, e.candidate_id, { status: result === 'PASSED' ? 'On probation' : 'Improvement plan not met' }, iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Improvement plan closed: ${result === 'PASSED' ? 'passed' : 'not passed'}.` });
  return employeeDetail(db, actor, p.employee_id);
}

// ---------- confirm, extend, separate ----------

export function confirmEmployee(db, actor, empId, now) {
  const e = employeeOr404(db, empId);
  if (e.status !== 'PROBATION') throw rule('Only an employee on probation can be confirmed.', 'wrong_status');
  if (activePip(db, empId)) throw rule('An improvement plan is still running. Close it before confirming.', 'pip_active');
  const reviews = helpers(db).all('SELECT * FROM reviews WHERE employee_id = ?', empId);
  const final = reviews.find((r) => r.period === 'FINAL');
  const early = reviews.find((r) => r.status === 'APPROVED' && r.weighted >= 4 && r.period !== 'FINAL');
  if (early && (!final || final.status !== 'APPROVED')) {
    // Early confirmation is allowed for an approved "exceeds" review.
  } else {
    if (!final) throw rule('The final review must be submitted before confirming.', 'no_final');
    if (final.status !== 'APPROVED') throw rule('The final review needs approval by someone else before confirming.', 'not_approved');
    if (final.weighted < policy(db, 'probation.confirmAt')) {
      throw rule(`The final score is ${final.weighted}. Confirmation needs ${policy(db, 'probation.confirmAt')} or more.`, 'score_low');
    }
  }
  helpers(db).run("UPDATE employees SET status = 'CONFIRMED' WHERE id = ?", empId);
  updateCandidateFields(db, e.candidate_id, { phase: 'CONFIRMED', status: 'Confirmed' }, iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Confirmed in employment by ${actor.name}. Confirmation letter ready.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'employee.confirm', entity: 'employee', entityId: empId });
  return employeeDetail(db, actor, empId);
}

/** One extension, only when the final score is between the PIP mark and the confirmation mark. */
export function extendEmployee(db, actor, empId, { months, goals }, now) {
  const e = employeeOr404(db, empId);
  if (e.status !== 'PROBATION') throw rule('Only an employee on probation can be extended.', 'wrong_status');
  if (e.extended) throw rule('Probation has already been extended once. Decide the outcome now.', 'extension_used');
  const final = helpers(db).one("SELECT * FROM reviews WHERE employee_id = ? AND period = 'FINAL' AND status = 'APPROVED'", empId);
  if (!final) throw rule('Extension is decided after the approved final review.', 'no_final');
  const confirmAt = policy(db, 'probation.confirmAt');
  const pipAt = policy(db, 'probation.pipAt');
  if (final.weighted >= confirmAt || final.weighted < pipAt) {
    throw rule(`Extension applies to final scores from ${pipAt} to below ${confirmAt}. This score is ${final.weighted}.`, 'not_extendable');
  }
  startPip(db, actor, e, { months, goals }, now, 'Probation extended with an improvement plan');
  const newEnd = day(addMonths(new Date(`${e.probation_end}T00:00:00Z`), months));
  helpers(db).run('UPDATE employees SET extended = 1, probation_end = ? WHERE id = ?', newEnd, empId);
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Probation extended to ${newEnd}.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'employee.extend', entity: 'employee', entityId: empId });
  return employeeDetail(db, actor, empId);
}

const SeparateInput = z.object({
  reason: z.string().trim().min(3, 'Give the reason for separation.'),
  misconduct: z.boolean().optional(),
  reviewsDocumented: z.boolean().optional(),
  pipGivenOrMisconduct: z.boolean().optional(),
  hrHeadApproved: z.boolean().optional(),
  rehireEligible: z.boolean().optional(),
  lastDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Separation during probation. The PDF's safeguards: reviews on time and shared, an improvement
 * plan given (or serious misconduct, which skips the plan), and the HR head's approval.
 */
export function separateEmployee(db, actor, empId, body, now) {
  const e = employeeOr404(db, empId);
  if (e.status !== 'PROBATION') throw rule('Only an employee on probation can be separated here.', 'wrong_status');
  const input = SeparateInput.parse(body ?? {});
  if (!input.misconduct) {
    const reviews = helpers(db).all('SELECT * FROM reviews WHERE employee_id = ?', empId);
    const lowOrFinal = reviews.some((r) => r.weighted < policy(db, 'probation.pipAt') || r.period === 'FINAL');
    const fails = [];
    if (!lowOrFinal) fails.push('A review below the improvement mark, or the final review, must exist first.');
    if (!input.reviewsDocumented) fails.push('Confirm the reviews were done on time and the feedback was shared.');
    if (!input.pipGivenOrMisconduct) fails.push('An improvement plan must have been given.');
    if (fails.length) throw rule(`Before separating: ${fails.join(' ')}`, 'fairness_check');
  }
  if (actor.role !== 'ADMIN' || !input.hrHeadApproved) {
    throw rule('The HR head must approve the separation. An admin records that approval.', 'approval_required', { hrHeadApproved: 'HR head approval is needed.' });
  }
  const last = input.lastDay ?? day(now);
  const reason = input.misconduct ? `Serious misconduct: ${input.reason}` : input.reason;
  const offboarding = policy(db, 'checklists.offboarding');
  const teams = ['IT', 'IT', 'ADMIN', 'HR', 'HR'];
  helpers(db).tx(() => {
    helpers(db).run("UPDATE employees SET status = 'SEPARATED', separated_on = ?, separation_reason = ?, rehire_eligible = ?, access_restricted = 1 WHERE id = ?",
      last, reason, input.rehireEligible === false ? 0 : 1, empId);
    helpers(db).run("UPDATE pips SET status = 'FAILED', reason = ? WHERE employee_id = ? AND status = 'ACTIVE'", 'Separated', empId);
    offboarding.forEach((label, i) => helpers(db).run(
      "INSERT INTO tasks (candidate_id, title, owner_team, kind, due_on, status, created_at) VALUES (?, ?, ?, 'OFFBOARD', ?, 'OPEN', ?)",
      e.candidate_id, label, teams[i] ?? 'HR', last, iso(now),
    ));
    updateCandidateFields(db, e.candidate_id, { stage: 'CLOSED', phase: 'SEPARATED', status: 'Separated', closedReason: 'Separated during probation' }, iso(now));
  });
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Separated, last day ${last}: ${reason}. Offboarding tasks created.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'employee.separate', entity: 'employee', entityId: empId, reason });
  return employeeDetail(db, actor, empId);
}

// ---------- surveys, goals, letters ----------

export function recordSurvey(db, actor, empId, { day: d, rating, comment }, now) {
  const e = employeeOr404(db, empId);
  if (!policy(db, 'probation.surveyDays').includes(d)) throw rule('Surveys are at day 30 and day 90.', 'bad_survey_day');
  if (!(rating >= 1 && rating <= 5)) throw rule('Rate from 1 to 5.', 'bad_rating', { rating: 'Choose 1 to 5.' });
  if (helpers(db).one('SELECT 1 AS x FROM surveys WHERE employee_id = ? AND day = ?', empId, d)) throw rule('This survey is already recorded.', 'already');
  helpers(db).run('INSERT INTO surveys (employee_id, day, rating, comment, recorded_at) VALUES (?, ?, ?, ?, ?)', empId, d, rating, (comment ?? '').trim(), iso(now));
  addEvent(db, e.candidate_id, { at: iso(now), userId: actor.id, kind: 'system', text: `Day ${d} onboarding survey recorded: ${rating} of 5.` });
  return employeeDetail(db, actor, empId);
}

export function addGoal(db, actor, empId, { period, text, dueOn }, now) {
  employeeOr404(db, empId);
  const t = (text ?? '').trim();
  if (t.length < 3) throw rule('Write the goal.', 'empty_goal', { text: 'Write the goal.' });
  helpers(db).run('INSERT INTO goals (employee_id, period, text, due_on) VALUES (?, ?, ?, ?)', empId, period ?? '30', t, dueOn ?? null);
  return employeeDetail(db, actor, empId);
}

export function letterText(db, empId, kind, extra = {}) {
  const e = helpers(db).one('SELECT e.*, r.title AS role, r.id AS req_id FROM employees e JOIN candidates c ON c.id = e.candidate_id JOIN requisitions r ON r.id = c.requisition_id WHERE e.id = ?', empId);
  if (!e) throw notFound('That employee');
  const company = policy(db, 'companyName');
  if (kind === 'confirmation') {
    if (e.status !== 'CONFIRMED') throw rule('The confirmation letter is ready once the employee is confirmed.', 'not_confirmed');
    return render(policy(db, 'templates.confirmationLetter'), { name: e.name, role: e.role, company, date: e.probation_end, code: e.employee_code });
  }
  if (kind === 'termination') {
    if (e.status !== 'SEPARATED') throw rule('The termination letter is ready once the employee is separated.', 'not_separated');
    return render(policy(db, 'templates.terminationLetter'), { name: e.name, role: e.role, company, date: e.separated_on, reason: e.separation_reason, ...extra });
  }
  throw notFound('That letter');
}

export { employeeOr404 };

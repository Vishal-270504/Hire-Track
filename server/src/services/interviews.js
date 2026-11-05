import { rule, notFound, forbidden } from '../errors.js';
import { audit } from '../audit/index.js';
import { helpers } from '../db/index.js';
import { findCandidateRow, updateCandidateFields, addEvent } from '../db/repo/candidates.js';
import { findRequisitionRow } from '../db/repo/requisitions.js';
import {
  findRoundRow, panelRows, panelMember, toRound, toPanel, roundsForCandidate, updateRoundFields,
  addPanelMember, removePanelMember, saveFeedback, declareConflict, busyAt,
} from '../db/repo/interviews.js';
import { policy } from '../policy/index.js';
import { render, whenText } from '../templates/render.js';
import { rejectCandidate, canSee, getCandidate } from './candidates.js';

const PANEL_ROLES = ['INTERVIEWER', 'HR', 'ADMIN'];
const STAFF_ACTIONS = ['HR', 'RECRUITER', 'ADMIN'];

/** Closed candidates cannot be moved forward by any interview decision. */
function assertOpen(db, candidateId) {
  const cand = findCandidateRow(db, candidateId);
  if (cand && cand.stage === 'CLOSED') throw rule('This candidate is closed, so nothing more can be recorded for them.', 'closed');
}

function roundOr404(db, id) {
  const r = findRoundRow(db, id);
  if (!r) throw notFound('That interview round');
  return r;
}

function assertRoundVisible(db, actor, round) {
  if (!canSee(db, actor, round.candidate_id)) throw notFound('That interview round');
}

function nextRoundOf(db, round) {
  return helpers(db).one(
    "SELECT * FROM interview_rounds WHERE candidate_id = ? AND position > ? AND status = 'WAITING' ORDER BY position LIMIT 1",
    round.candidate_id, round.position,
  );
}

/** Turns a round's verdict into the next state: next round to schedule, a decision for HR, or a failure. */
function applyPass(db, actor, round, note, now) {
  const iso = now.toISOString();
  updateRoundFields(db, round.id, { status: 'PASSED', decidedAt: iso, resultNote: note ?? null });
  const next = nextRoundOf(db, round);
  if (next) {
    updateRoundFields(db, next.id, { status: next.type === 'FINAL_APPROVAL' ? 'PENDING_FINAL' : 'TO_SCHEDULE' });
    updateCandidateFields(db, round.candidate_id, { status: `${round.name} passed` }, iso);
  } else {
    updateCandidateFields(db, round.candidate_id, { status: 'Ready for a final decision' }, iso);
  }
  addEvent(db, round.candidate_id, { at: iso, userId: actor?.id ?? null, kind: 'decision', text: `Passed ${round.name}.${note ? ` ${note}` : ''}` });
}

function applyFail(db, actor, round, note, now) {
  const iso = now.toISOString();
  updateRoundFields(db, round.id, { status: 'FAILED', decidedAt: iso, resultNote: note ?? null });
  updateCandidateFields(db, round.candidate_id, { status: `${round.name} not passed: HR to decide` }, iso);
  addEvent(db, round.candidate_id, { at: iso, userId: actor?.id ?? null, kind: 'decision', text: `Did not pass ${round.name}.${note ? ` ${note}` : ''}` });
}

function applyDecisionNeeded(db, actor, round, now) {
  const iso = now.toISOString();
  updateRoundFields(db, round.id, { status: 'DECISION_NEEDED' });
  updateCandidateFields(db, round.candidate_id, { status: `Decision needed: ${round.name}` }, iso);
  addEvent(db, round.candidate_id, { at: iso, userId: actor?.id ?? null, kind: 'system', text: `Panel disagrees on ${round.name}. HR to make the call.` });
}

/** Scores the round once every active panel member has submitted. */
function evaluate(db, actor, round, now) {
  const req = helpers(db).one(
    `SELECT r.* FROM hiring_rounds r WHERE r.id = ?`, round.hiring_round_id,
  );
  const plan = req ?? {};
  const panel = panelRows(db, round.id).filter((p) => !p.conflict);
  if (round.type === 'ONLINE_TEST') {
    if (round.test_score == null) return;
    const pass = round.test_score >= (plan.pass_percent ?? 60);
    return pass ? applyPass(db, actor, round, `Score ${round.test_score}%.`, now)
      : applyFail(db, actor, round, `Score ${round.test_score}%, below the pass mark.`, now);
  }
  if (!panel.length || panel.some((p) => !p.submitted_at)) return;

  if (round.type === 'SCORECARD' || round.type === 'TAKE_HOME') {
    const bar = plan.pass_average ?? 3;
    const verdicts = panel.map((p) => p.avg >= bar);
    const avg = panel.reduce((a, p) => a + p.avg, 0) / panel.length;
    if (verdicts.every(Boolean)) return applyPass(db, actor, round, `Panel average ${avg.toFixed(1)} of 5.`, now);
    if (verdicts.every((v) => !v)) return applyFail(db, actor, round, `Panel average ${avg.toFixed(1)} of 5, below ${bar}.`, now);
    return applyDecisionNeeded(db, actor, round, now);
  }
  if (round.type === 'DECISION') {
    const hire = panel.map((p) => p.recommendation === 'HIRE');
    if (hire.every(Boolean)) return applyPass(db, actor, round, 'Panel recommends hire.', now);
    if (hire.every((v) => !v)) return applyFail(db, actor, round, 'Panel does not recommend hire.', now);
    return applyDecisionNeeded(db, actor, round, now);
  }
  // FINAL_APPROVAL is decided by HR through finalDecision, never by a panel.
}

export function scheduleRound(db, actor, roundId, body, now) {
  const round = roundOr404(db, roundId);
  assertRoundVisible(db, actor, round);
  const cand = findCandidateRow(db, round.candidate_id);
  if (cand.stage === 'CLOSED') throw rule('This candidate is closed, so no interview can be booked.', 'closed');
  if (!['TO_SCHEDULE', 'SCHEDULED', 'NO_SHOW'].includes(round.status)) {
    throw rule(`${round.name} cannot be scheduled right now (it is ${round.status.toLowerCase().replace('_', ' ')}).`, 'bad_state');
  }
  const when = new Date(body.when);
  if (Number.isNaN(when.getTime())) throw rule('Pick a date and time.', 'bad_time', { when: 'Pick a date and time.' });
  if (when <= now) throw rule('Pick a time in the future.', 'bad_time', { when: 'That time has already passed.' });
  const needsPanel = round.type !== 'ONLINE_TEST';
  const panelIds = [...new Set(body.panelIds ?? [])];
  if (needsPanel && panelIds.length === 0) throw rule('Choose at least one interviewer for this round.', 'no_panel', { panelIds: 'Choose an interviewer.' });
  if (body.link !== undefined && body.link !== '' && !/^https?:\/\//i.test(String(body.link))) {
    throw rule('Use a full web address starting with http:// or https://.', 'bad_link', { link: 'Use http:// or https://.' });
  }
  if (body.link !== undefined && round.type === 'ONLINE_TEST' && !String(body.link).trim()) {
    throw rule('Add the test link the candidate should use.', 'no_link', { link: 'Add the test link.' });
  }

  // Each change after the first counts. The limit is from policy (default 2); a third needs HR approval.
  const isReschedule = round.status === 'SCHEDULED';
  const limit = policy(db, 'interviews.rescheduleLimit');
  const nextCount = round.reschedules + (isReschedule ? 1 : 0);
  if (isReschedule && nextCount > limit) {
    if (!(body.approveExtraReschedule && ['HR', 'ADMIN'].includes(actor.role))) {
      throw rule(`This round has already been moved ${limit} times. A further change needs HR approval.`, 'reschedule_limit',
        { approveExtraReschedule: 'Ask HR to approve this change.' });
    }
  }

  const iso = when.toISOString();
  for (const uid of panelIds) {
    const member = helpers(db).one("SELECT id, role, active FROM users WHERE id = ?", uid);
    if (!member || !member.active || !PANEL_ROLES.includes(member.role)) {
      throw rule('Interviewers must be active interviewer, HR or admin accounts.', 'bad_panel', { panelIds: 'Choose active interviewers.' });
    }
    if (busyAt(db, uid, iso)) {
      throw rule('One of the interviewers already has an interview within an hour of this time. Pick another time or another interviewer.', 'panel_busy');
    }
  }

  helpers(db).tx(() => {
    const existing = panelRows(db, roundId);
    for (const p of existing) if (!panelIds.includes(p.user_id) && !p.submitted_at) removePanelMember(db, roundId, p.user_id);
    for (const uid of panelIds) addPanelMember(db, roundId, uid);
    updateRoundFields(db, roundId, {
      status: 'SCHEDULED',
      scheduledAt: iso,
      timeZone: body.timeZone ?? 'Asia/Kolkata',
      link: body.link ?? round.link ?? '',
      reschedules: nextCount,
    });
  });
  const when_ = whenText(iso, body.timeZone ?? 'Asia/Kolkata');
  addEvent(db, round.candidate_id, {
    at: now.toISOString(), userId: actor.id, kind: 'system',
    text: `${isReschedule ? 'Rescheduled' : 'Scheduled'} ${round.name} for ${when_}.`,
  });
  audit(db, { at: now.toISOString(), userId: actor.id, action: isReschedule ? 'round.reschedule' : 'round.schedule', entity: 'interview_round', entityId: roundId, detail: { when: iso } });
  return getCandidate(db, actor, round.candidate_id);
}

export function noShow(db, actor, roundId, { confirmReject }, now) {
  const round = roundOr404(db, roundId);
  assertRoundVisible(db, actor, round);
  assertOpen(db, round.candidate_id);
  if (round.status !== 'SCHEDULED') throw rule('Only a scheduled round can be marked as a no-show.', 'bad_state');
  const count = round.no_shows + 1;
  const iso = now.toISOString();
  if (count >= 2 && !confirmReject) {
    throw rule('This is the second no-show. Only HR can end the process here, so ask HR to confirm the rejection.', 'needs_hr_confirm', {
      confirmReject: 'HR must confirm.',
    });
  }
  updateRoundFields(db, roundId, { noShows: count, status: 'NO_SHOW', scheduledAt: null });
  addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'system', text: `No-show for ${round.name} (${count}).` });
  if (count >= 2) {
    return rejectCandidate(db, actor, round.candidate_id, 'Did not attend two interviews', now);
  }
  return getCandidate(db, actor, round.candidate_id);
}

export function submitFeedback(db, actor, roundId, body, now) {
  const round = roundOr404(db, roundId);
  assertRoundVisible(db, actor, round);
  assertOpen(db, round.candidate_id);
  if (!['SCHEDULED', 'HELD', 'FAILED', 'DECISION_NEEDED'].includes(round.status)) {
    throw rule(`Feedback for ${round.name} is not needed right now.`, 'bad_state');
  }
  const iso = now.toISOString();
  const integrity = !!body.integrityFlag;

  if (round.type === 'ONLINE_TEST') {
    if (!STAFF_ACTIONS.includes(actor.role)) throw forbidden('Only HR or recruiters can record a test score.');
    if (body.testScore == null) throw rule('Enter the test score as a percentage.', 'no_score', { testScore: 'Enter the score.' });
    updateRoundFields(db, roundId, { testScore: body.testScore });
    addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'note', text: `Test score ${body.testScore}% for ${round.name}.${body.note ? ` ${body.note}` : ''}` });
    if (integrity) return holdForIntegrity(db, actor, round, now);
    evaluate(db, actor, { ...round, test_score: body.testScore }, now);
    return getCandidate(db, actor, round.candidate_id);
  }

  const member = panelMember(db, roundId, actor.id);
  if (!member) throw forbidden('You are not on the interview panel for this round.');
  if (member.conflict) throw rule('You declared a conflict of interest for this round, so you cannot add feedback.', 'conflict');
  if (member.submitted_at) throw rule('You have already submitted feedback for this round.', 'already_submitted');

  const comments = (body.comments ?? '').trim();
  if (comments.length < 3) throw rule('Write a few words on the candidate. Feedback is needed before any decision.', 'no_comments', { comments: 'Add a few words.' });
  const scores = body.scores ?? null;
  let avg = null;
  if (round.type === 'SCORECARD' || round.type === 'TAKE_HOME') {
    const vals = Object.values(scores ?? {});
    if (!vals.length || vals.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) {
      throw rule('Score each skill from 1 to 5.', 'bad_scores', { scores: 'Score each skill from 1 to 5.' });
    }
    avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  if (round.type === 'DECISION' && !['HIRE', 'NO_HIRE'].includes(body.recommendation)) {
    throw rule('Choose hire or no hire.', 'no_recommendation', { recommendation: 'Choose hire or no hire.' });
  }
  saveFeedback(db, roundId, actor.id, {
    scores, avg, recommendation: body.recommendation ?? (avg != null ? (avg >= policy(db, 'interviews.roundPassAverage') ? 'HIRE' : 'NO_HIRE') : null),
    comments,
  }, iso);
  addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'note', text: `Feedback on ${round.name}: ${comments}` });

  if (integrity) return holdForIntegrity(db, actor, round, now);
  evaluate(db, actor, round, now);
  return getCandidate(db, actor, round.candidate_id);
}

function holdForIntegrity(db, actor, round, now) {
  const iso = now.toISOString();
  updateRoundFields(db, round.id, { status: 'HELD', integrityFlag: true });
  updateCandidateFields(db, round.candidate_id, { onHold: true, holdReason: `Integrity flag on ${round.name}. HR to review.`, status: 'Held for review' }, iso);
  addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'decision', text: `Integrity flag raised on ${round.name}. Result held for HR review.` });
  return getCandidate(db, actor, round.candidate_id);
}

/** HR resolves a split panel or a failed round. Outcome is recorded with a note. */
export function resolveDecision(db, actor, roundId, { outcome, note }, now) {
  const round = roundOr404(db, roundId);
  assertOpen(db, round.candidate_id);
  if (round.status !== 'DECISION_NEEDED' && round.status !== 'FAILED') throw rule('This round does not need a decision.', 'bad_state');
  const text = (note ?? '').trim();
  if (text.length < 3) throw rule('Add a note on why you decided this.', 'reason_required', { note: 'Add a short note.' });
  if (outcome === 'PASS') applyPass(db, actor, round, text, now);
  else if (outcome === 'FAIL') rejectCandidate(db, actor, round.candidate_id, `${round.name}: ${text}`, now);
  else throw rule('Choose pass or reject.', 'bad_outcome');
  return getCandidate(db, actor, round.candidate_id);
}

export function resolveHold(db, actor, roundId, { decision, note }, now) {
  const round = roundOr404(db, roundId);
  assertOpen(db, round.candidate_id);
  if (round.status !== 'HELD') throw rule('This round is not on hold.', 'bad_state');
  const text = (note ?? '').trim();
  if (text.length < 3) throw rule('Say what you found, so the decision is clear later.', 'reason_required', { note: 'Add a short note.' });
  const iso = now.toISOString();
  if (decision === 'CONTINUE') {
    updateRoundFields(db, roundId, { status: 'SCHEDULED', integrityFlag: false });
    updateCandidateFields(db, round.candidate_id, { onHold: false, holdReason: null, status: `${round.name} back in progress` }, iso);
    addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'decision', text: `Integrity review closed, continuing: ${text}` });
    evaluate(db, actor, { ...round, status: 'SCHEDULED' }, now);
  } else if (decision === 'REJECT') {
    rejectCandidate(db, actor, round.candidate_id, `Integrity concern on ${round.name}: ${text}`, now);
  } else {
    throw rule('Choose continue or reject.', 'bad_decision');
  }
  return getCandidate(db, actor, round.candidate_id);
}

export function reissueTest(db, actor, roundId, { reason }, now) {
  const round = roundOr404(db, roundId);
  if (round.type !== 'ONLINE_TEST') throw rule('Only online tests can be re-issued.', 'not_a_test');
  if (!['FAILED', 'HELD'].includes(round.status)) throw rule('Re-issue only after a problem with the test.', 'bad_state');
  if (round.test_reissued) throw rule('The test has already been re-issued once. Decide the outcome instead.', 'reissue_used');
  const text = (reason ?? '').trim();
  if (text.length < 3) throw rule('Say why the test is being re-issued, for example "test link expired".', 'reason_required', { reason: 'Add a reason.' });
  const iso = now.toISOString();
  updateRoundFields(db, roundId, { status: 'TO_SCHEDULE', testScore: null, testReissued: true, integrityFlag: false });
  updateCandidateFields(db, round.candidate_id, { onHold: false, holdReason: null, status: `${round.name} to re-send` }, iso);
  addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'decision', text: `Test re-issued once: ${text}` });
  return getCandidate(db, actor, round.candidate_id);
}

/** HR's final approval after the last panel round. Approve moves the candidate to Selected. */
export function finalDecision(db, actor, roundId, { decision, comment }, now) {
  const round = roundOr404(db, roundId);
  assertOpen(db, round.candidate_id);
  if (round.status !== 'PENDING_FINAL') throw rule('This is not waiting for a final decision.', 'bad_state');
  const iso = now.toISOString();
  if (decision === 'APPROVE') {
    updateRoundFields(db, roundId, { status: 'PASSED', decidedAt: iso, resultNote: comment ?? null });
    updateCandidateFields(db, round.candidate_id, { stage: 'SELECTED', phase: 'OFFER', status: 'Selected, ready for offer' }, iso);
    addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'decision', text: `Final approval given${comment ? `: ${comment}` : ''}. Selected for an offer.` });
    audit(db, { at: iso, userId: actor.id, action: 'candidate.select', entity: 'candidate', entityId: round.candidate_id });
  } else if (decision === 'REJECT') {
    const text = (comment ?? '').trim();
    if (text.length < 3) throw rule('Say why the final approval is refused.', 'reason_required', { comment: 'Add a short reason.' });
    rejectCandidate(db, actor, round.candidate_id, `Final approval refused: ${text}`, now);
  } else {
    throw rule('Choose approve or reject.', 'bad_decision');
  }
  return getCandidate(db, actor, round.candidate_id);
}

export function declareInterviewConflict(db, actor, roundId, { note }, now) {
  const round = roundOr404(db, roundId);
  const member = panelMember(db, roundId, actor.id);
  if (!member) throw forbidden('Only a panel member can declare a conflict.');
  if (member.submitted_at) throw rule('You have already given feedback, so the conflict is no longer needed.', 'already_submitted');
  const text = (note ?? '').trim() || 'Knows the candidate';
  declareConflict(db, roundId, actor.id, text);
  const iso = now.toISOString();
  addEvent(db, round.candidate_id, { at: iso, userId: actor.id, kind: 'system', text: `${actor.name} declared a conflict for ${round.name}. HR should reassign.` });
  return getCandidate(db, actor, round.candidate_id);
}

/** HR replaces the panel for a round (after a conflict, or when someone is unavailable). */
export function replacePanel(db, actor, roundId, { userIds }, now) {
  const round = roundOr404(db, roundId);
  if (!userIds?.length) throw rule('Choose at least one interviewer.', 'no_panel', { userIds: 'Choose an interviewer.' });
  for (const uid of userIds) {
    const m = helpers(db).one('SELECT id, role, active FROM users WHERE id = ?', uid);
    if (!m || !m.active || !PANEL_ROLES.includes(m.role)) throw rule('Interviewers must be active interview, HR or admin accounts.', 'bad_panel');
  }
  helpers(db).tx(() => {
    for (const p of panelRows(db, roundId)) if (!p.submitted_at) removePanelMember(db, roundId, p.user_id);
    for (const uid of userIds) addPanelMember(db, roundId, uid);
  });
  addEvent(db, round.candidate_id, { at: now.toISOString(), userId: actor.id, kind: 'system', text: `Panel for ${round.name} updated.` });
  return getCandidate(db, actor, round.candidate_id);
}

/** Interviewers from other panels who are free at the round's time. */
export function suggestPanel(db, actor, roundId) {
  const round = roundOr404(db, roundId);
  const req = helpers(db).one(
    'SELECT c.requisition_id FROM candidates c WHERE c.id = ?', round.candidate_id,
  );
  const people = helpers(db).all(
    `SELECT DISTINCT u.id, u.name, u.role FROM users u
      WHERE u.active = 1 AND u.role IN ('INTERVIEWER','HR','ADMIN') ORDER BY u.name`,
  );
  const busyIds = new Set(
    round.scheduled_at ? people.filter((p) => busyAt(db, p.id, round.scheduled_at)).map((p) => p.id) : [],
  );
  return {
    requisitionId: req?.requisition_id ?? null,
    suggestions: people.filter((p) => !busyIds.has(p.id)),
    busy: people.filter((p) => busyIds.has(p.id)).map((p) => p.name),
  };
}

/** A calendar invite (.ics) for the candidate and the panel. Works in any calendar app. */
export function inviteIcs(db, actor, roundId) {
  const round = roundOr404(db, roundId);
  if (!round.scheduled_at) throw rule('Schedule the round before sending an invite.', 'not_scheduled');
  const cand = helpers(db).one(
    'SELECT c.name, r.title FROM candidates c JOIN requisitions r ON r.id = c.requisition_id WHERE c.id = ?', round.candidate_id,
  );
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + 60 * 60_000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const body = render(policy(db, 'templates.interviewInvite'), {
    name: cand.name, round: round.name, role: cand.title, when: whenText(round.scheduled_at, round.time_zone), zone: round.time_zone, link: round.link,
  });
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HireTrack//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:round-${round.id}@hiretrack.local`,
    `DTSTAMP:${stamp(new Date())}Z`,
    `DTSTART:${stamp(start)}Z`,
    `DTEND:${stamp(end)}Z`,
    `SUMMARY:${esc(`${round.name}: ${cand.name} (${cand.title})`)}`,
    `DESCRIPTION:${esc(body)}`,
    round.link ? `URL:${round.link}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export { toRound, toPanel, roundsForCandidate, findRequisitionRow, evaluate, applyPass, applyFail, nextRoundOf };

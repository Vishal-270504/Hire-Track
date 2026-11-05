import { z } from 'zod';
import { rule, notFound, forbidden } from '../errors.js';
import { audit } from '../audit/index.js';
import { helpers } from '../db/index.js';
import { updateCandidateFields, addEvent } from '../db/repo/candidates.js';
import { findRequisitionRow } from '../db/repo/requisitions.js';
import { policy } from '../policy/index.js';
import { render } from '../templates/render.js';
import { requireCandidate, getCandidate } from './candidates.js';
import { createPrepTasks, cancelOpenTasks } from './joining.js';

const ACTIVE = ['PENDING_APPROVAL', 'SENT', 'NEGOTIATING', 'ACCEPTED'];
const OPEN_FOR_REPLY = ['SENT', 'NEGOTIATING'];
const iso = (d) => d.toISOString();
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const day = (d) => d.toISOString().slice(0, 10);

const OfferInput = z.object({
  ctcLpa: z.number().positive('Enter the CTC in lakhs per year.').max(500),
  fixedLpa: z.number().min(0).max(500).nullable().optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a joining date.'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  backup: z.boolean().optional(),
});

export const offersFor = (db, candidateId) => helpers(db).all(
  'SELECT * FROM offers WHERE candidate_id = ? ORDER BY version DESC', candidateId,
).map(toOffer);

export function toOffer(o) {
  return o && {
    id: o.id, candidateId: o.candidate_id, version: o.version, ctcLpa: o.ctc_lpa, fixedLpa: o.fixed_lpa,
    joinDate: o.join_date, expiryDate: o.expiry_date, extensions: o.extensions, status: o.status,
    aboveBudget: !!o.above_budget, backup: !!o.backup, approvedBy: o.approved_by, letter: o.letter,
    signName: o.sign_name, signAt: o.sign_at, responseNote: o.response_note, createdAt: o.created_at,
  };
}

const findOffer = (db, id) => {
  const o = helpers(db).one('SELECT * FROM offers WHERE id = ?', id);
  if (!o) throw notFound('That offer');
  return o;
};

const activeOffer = (db, candidateId) => helpers(db).one(
  `SELECT * FROM offers WHERE candidate_id = ? AND status IN ('PENDING_APPROVAL','SENT','NEGOTIATING','ACCEPTED')
   ORDER BY version DESC LIMIT 1`, candidateId,
);

function setOfferStatus(db, id, status, extra = {}) {
  const cols = Object.keys(extra);
  const sets = ['status = ?', ...cols.map((c) => `${c} = ?`)].join(', ');
  helpers(db).run(`UPDATE offers SET ${sets} WHERE id = ?`, status, ...cols.map((c) => extra[c]), id);
}

function letterFor(db, cand, req, o) {
  return render(policy(db, 'templates.offerLetter'), {
    name: cand.name, role: req.title, company: policy(db, 'companyName') ?? 'HireTrack', ctc: o.ctcLpa,
    joinDate: o.joinDate, expiry: o.expiryDate,
  });
}

/** Creates the first offer (or a backup) after final approval. Above-budget and backup offers need HR approval. */
export function createOffer(db, actor, candidateId, body, now) {
  const cand = requireCandidate(db, actor, candidateId);
  const input = OfferInput.parse(body ?? {});
  if (cand.stage !== 'SELECTED' || cand.phase !== 'OFFER') {
    throw rule('An offer can be made once the candidate has final approval.', 'not_selected');
  }
  if (activeOffer(db, candidateId)) throw rule('There is already an active offer. Revise it instead.', 'active_offer');
  const req = findRequisitionRow(db, cand.requisition_id);

  // Headcount: each opening can carry one accepted or sent offer, unless HR marks extra offers as backup.
  const taken = helpers(db).one(
    `SELECT COUNT(*) AS n FROM offers o JOIN candidates c ON c.id = o.candidate_id
      WHERE c.requisition_id = ? AND o.status IN ('PENDING_APPROVAL','SENT','NEGOTIATING','ACCEPTED') AND o.backup = 0`,
    cand.requisition_id,
  ).n;
  const backup = !!input.backup;
  if (taken >= req.headcount && !backup) {
    throw rule(`All ${req.headcount} opening${req.headcount > 1 ? 's' : ''} already ${req.headcount > 1 ? 'have' : 'has'} an offer. HR can add headcount, or mark this as a backup offer.`, 'headcount_full',
      { headcount: 'No openings left.' });
  }
  if (backup && !['HR', 'ADMIN'].includes(actor.role)) throw forbidden('Only HR can make a backup offer.');

  const aboveBudget = req.budget_max_lpa != null && input.ctcLpa > req.budget_max_lpa;
  const validity = policy(db, 'offer.validityDays');
  const expiry = input.expiryDate ?? day(addDays(now, validity));
  const row = {
    candidate_id: candidateId, version: 1, ctc_lpa: input.ctcLpa, fixed_lpa: input.fixedLpa ?? null,
    join_date: input.joinDate, expiry_date: expiry, status: aboveBudget ? 'PENDING_APPROVAL' : 'SENT',
    above_budget: aboveBudget ? 1 : 0, backup: backup ? 1 : 0, created_at: iso(now), created_by: actor.id,
  };
  const info = helpers(db).run(
    `INSERT INTO offers (candidate_id, version, ctc_lpa, fixed_lpa, join_date, expiry_date, status, above_budget, backup, letter, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
    row.candidate_id, row.version, row.ctc_lpa, row.fixed_lpa, row.join_date, row.expiry_date, row.status,
    row.above_budget, row.backup, row.created_at, row.created_by,
  );
  const id = Number(info.lastInsertRowid);
  const o = { ...toOffer(findOffer(db, id)), ctcLpa: input.ctcLpa, joinDate: input.joinDate, expiryDate: expiry };
  setOfferStatus(db, id, row.status, { letter: letterFor(db, cand, req, o) });
  const text = aboveBudget ? 'Offer waiting for approval, because the CTC is above budget.' : `Offer sent: ${input.ctcLpa} LPA, expires ${expiry}.`;
  updateCandidateFields(db, candidateId, { status: aboveBudget ? 'Offer waiting for approval' : 'Offer sent' }, iso(now));
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: text + (backup ? ' Marked as backup.' : '') });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.create', entity: 'candidate', entityId: candidateId, detail: { ctc: input.ctcLpa, aboveBudget, backup } });
  return getCandidate(db, actor, candidateId);
}

export function approveOffer(db, actor, offerId, now) {
  const o = findOffer(db, offerId);
  requireCandidate(db, actor, o.candidate_id);
  if (o.status !== 'PENDING_APPROVAL') throw rule('This offer is not waiting for approval.', 'not_pending');
  const expiry = day(addDays(now, policy(db, 'offer.validityDays')));
  setOfferStatus(db, offerId, 'SENT', { approved_by: actor.name, expiry_date: expiry });
  updateCandidateFields(db, o.candidate_id, { status: 'Offer sent' }, iso(now));
  addEvent(db, o.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Offer approved by ${actor.name}. Sent to the candidate.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.approve', entity: 'offer', entityId: offerId });
  return getCandidate(db, actor, o.candidate_id);
}

/** A new version of the offer (for example after a counter-offer). The old version is kept, marked superseded. */
export function reviseOffer(db, actor, candidateId, body, now) {
  const cand = requireCandidate(db, actor, candidateId);
  const current = activeOffer(db, candidateId);
  if (!current || current.status === 'ACCEPTED') throw rule('There is no open offer to revise.', 'no_open_offer');
  const input = OfferInput.parse(body ?? {});
  const req = findRequisitionRow(db, cand.requisition_id);
  const aboveBudget = req.budget_max_lpa != null && input.ctcLpa > req.budget_max_lpa;
  setOfferStatus(db, current.id, 'SUPERSEDED');
  const expiry = input.expiryDate ?? day(addDays(now, policy(db, 'offer.validityDays')));
  const status = aboveBudget ? 'PENDING_APPROVAL' : 'SENT';
  const info = helpers(db).run(
    `INSERT INTO offers (candidate_id, version, ctc_lpa, fixed_lpa, join_date, expiry_date, status, above_budget, backup, letter, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
    candidateId, current.version + 1, input.ctcLpa, input.fixedLpa ?? null, input.joinDate, expiry, status,
    aboveBudget ? 1 : 0, current.backup, iso(now), actor.id,
  );
  const id = Number(info.lastInsertRowid);
  setOfferStatus(db, id, status, { letter: letterFor(db, cand, req, { ctcLpa: input.ctcLpa, joinDate: input.joinDate, expiryDate: expiry }) });
  updateCandidateFields(db, candidateId, { status: aboveBudget ? 'Offer waiting for approval' : 'Offer revised' }, iso(now));
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `Offer revised to version ${current.version + 1}: ${input.ctcLpa} LPA.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.revise', entity: 'candidate', entityId: candidateId, detail: { version: current.version + 1 } });
  return getCandidate(db, actor, candidateId);
}

/** The candidate says yes. Their typed name is the e-signature. Prep tasks start for the joining date. */
export function acceptOffer(db, actor, offerId, { signName, byCandidate = false }, now) {
  const o = findOffer(db, offerId);
  if (!OPEN_FOR_REPLY.includes(o.status)) throw rule('This offer can no longer be accepted.', 'not_open');
  if (day(now) > o.expiry_date) {
    throw rule('This offer has expired. Ask HR to extend it, or revise it.', 'expired');
  }
  const name = (signName ?? '').trim();
  if (name.length < 3) throw rule('Type your full name to sign.', 'sign_required', { signName: 'Type your full name.' });
  const cand = helpers(db).one('SELECT * FROM candidates WHERE id = ?', o.candidate_id);
  if (cand.stage === 'CLOSED') throw rule('This candidate is closed. The offer can no longer be accepted.', 'closed');
  helpers(db).tx(() => {
    setOfferStatus(db, offerId, 'ACCEPTED', { sign_name: name, sign_at: iso(now) });
    helpers(db).run("UPDATE offers SET status = 'SUPERSEDED' WHERE candidate_id = ? AND id != ? AND status IN ('SENT','NEGOTIATING','PENDING_APPROVAL')", o.candidate_id, offerId);
    updateCandidateFields(db, o.candidate_id, { phase: 'PRE_JOINING', joinDate: o.join_date, status: 'Offer accepted' }, iso(now));
    createPrepTasks(db, o.candidate_id, o.join_date, now);
  });
  addEvent(db, o.candidate_id, { at: iso(now), userId: byCandidate ? null : actor.id, kind: 'decision', text: `Offer accepted and signed by ${name}. Joining ${o.join_date}.` });
  audit(db, { at: iso(now), userId: byCandidate ? null : actor.id, action: 'offer.accept', entity: 'offer', entityId: offerId });
  return cand.id;
}

export function negotiateOffer(db, actor, offerId, { note }, now) {
  const o = findOffer(db, offerId);
  requireCandidate(db, actor, o.candidate_id);
  if (o.status !== 'SENT') throw rule('Only a sent offer can be put into negotiation.', 'not_sent');
  const text = (note ?? '').trim();
  if (text.length < 3) throw rule('Note what the candidate asked for.', 'reason_required', { note: 'Describe the request.' });
  setOfferStatus(db, offerId, 'NEGOTIATING', { response_note: text });
  updateCandidateFields(db, o.candidate_id, { status: 'Offer under negotiation' }, iso(now));
  addEvent(db, o.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Candidate is negotiating: ${text}` });
  return getCandidate(db, actor, o.candidate_id);
}

/** The candidate says no. Runner-up candidates for the same role are suggested. */
export function declineOffer(db, actor, offerId, { reason }, now) {
  const o = findOffer(db, offerId);
  requireCandidate(db, actor, o.candidate_id);
  if (!OPEN_FOR_REPLY.includes(o.status)) throw rule('This offer cannot be declined now.', 'not_open');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Say why they declined, so the record is useful later.', 'reason_required', { reason: 'Add a short reason.' });
  helpers(db).tx(() => {
    setOfferStatus(db, offerId, 'DECLINED', { response_note: why });
    updateCandidateFields(db, o.candidate_id, { stage: 'CLOSED', status: 'Offer declined', closedReason: 'Offer declined', onHold: false }, iso(now));
  });
  addEvent(db, o.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Offer declined: ${why}` });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.decline', entity: 'offer', entityId: offerId, reason: why });
  return { candidate: getCandidate(db, actor, o.candidate_id), runnerUps: runnerUps(db, o.candidate_id) };
}

export function extendOffer(db, actor, offerId, now) {
  const o = findOffer(db, offerId);
  requireCandidate(db, actor, o.candidate_id);
  if (!OPEN_FOR_REPLY.includes(o.status)) throw rule('Only an open offer can be extended.', 'not_open');
  const max = policy(db, 'offer.maxExtensions');
  if (o.extensions >= max) throw rule(`This offer has already been extended ${max} time${max === 1 ? '' : 's'}. Revise it instead.`, 'extension_used');
  const next = day(addDays(new Date(o.expiry_date), policy(db, 'offer.extensionDays')));
  setOfferStatus(db, offerId, o.status, { expiry_date: next, extensions: o.extensions + 1 });
  addEvent(db, o.candidate_id, { at: iso(now), userId: actor.id, kind: 'decision', text: `Offer extended to ${next}.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.extend', entity: 'offer', entityId: offerId });
  return getCandidate(db, actor, o.candidate_id);
}

/** Runs from the reminder engine: open offers past their expiry date are expired. */
export function expireOffers(db, now) {
  const today = day(now);
  const rows = helpers(db).all("SELECT * FROM offers WHERE status IN ('SENT','NEGOTIATING') AND expiry_date < ?", today);
  for (const o of rows) {
    setOfferStatus(db, o.id, 'EXPIRED');
    updateCandidateFields(db, o.candidate_id, { stage: 'CLOSED', status: 'Offer expired', closedReason: 'Offer expired' }, iso(now));
    addEvent(db, o.candidate_id, { at: iso(now), userId: null, kind: 'system', text: 'Offer expired without a reply.' });
  }
  return rows.length;
}

/** HR revokes an offer (for example after a background check fails). Needs a reason. */
export function revokeOffer(db, actor, candidateId, { reason }, now) {
  requireCandidate(db, actor, candidateId);
  const o = activeOffer(db, candidateId);
  if (!o) throw rule('There is no active offer to revoke.', 'no_offer');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Give the reason for revoking the offer.', 'reason_required', { reason: 'Add a reason.' });
  helpers(db).tx(() => {
    setOfferStatus(db, o.id, 'REVOKED', { response_note: why });
    cancelOpenTasks(db, candidateId);
    updateCandidateFields(db, candidateId, { stage: 'CLOSED', status: 'Offer revoked', closedReason: 'Offer revoked', onHold: false }, iso(now));
  });
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `Offer revoked: ${why}` });
  audit(db, { at: iso(now), userId: actor.id, action: 'offer.revoke', entity: 'candidate', entityId: candidateId, reason: why });
  return { candidate: getCandidate(db, actor, candidateId), runnerUps: runnerUps(db, candidateId) };
}

/** Declined after accepting: the joining tasks (laptop, email, ID) are cancelled and the role is re-opened for runners-up. */
export function backOut(db, actor, candidateId, { reason }, now) {
  requireCandidate(db, actor, candidateId);
  const o = helpers(db).one("SELECT * FROM offers WHERE candidate_id = ? AND status = 'ACCEPTED'", candidateId);
  if (!o) throw rule('Only a candidate who accepted an offer can back out.', 'not_accepted');
  const why = (reason ?? '').trim();
  if (why.length < 3) throw rule('Say why they backed out.', 'reason_required', { reason: 'Add a reason.' });
  helpers(db).tx(() => {
    setOfferStatus(db, o.id, 'REVOKED', { response_note: `Backed out: ${why}` });
    cancelOpenTasks(db, candidateId);
    updateCandidateFields(db, candidateId, { stage: 'CLOSED', status: 'Backed out', closedReason: 'Backed out', onHold: false }, iso(now));
  });
  addEvent(db, candidateId, { at: iso(now), userId: actor.id, kind: 'decision', text: `Backed out after accepting: ${why}. Joining tasks cancelled.` });
  audit(db, { at: iso(now), userId: actor.id, action: 'candidate.backed_out', entity: 'candidate', entityId: candidateId, reason: why });
  return { candidate: getCandidate(db, actor, candidateId), runnerUps: runnerUps(db, candidateId) };
}

/** Candidates still in the running for the same role, best screening score first. */
export function runnerUps(db, candidateId) {
  const c = helpers(db).one('SELECT requisition_id FROM candidates WHERE id = ?', candidateId);
  return helpers(db).all(
    `SELECT id, name, ats_score AS atsScore, status FROM candidates
      WHERE requisition_id = ? AND id != ? AND stage IN ('SCREENING','INTERVIEWS') AND on_hold = 0
      ORDER BY ats_score DESC LIMIT 3`,
    c.requisition_id, candidateId,
  );
}


import { z } from 'zod';
import { rule, notFound, AppError } from '../errors.js';
import { helpers } from '../db/index.js';
import { createCandidate } from './candidates.js';
import { storeDocumentFile } from './joining.js';
import { acceptOffer, declineOffer, negotiateOffer } from './offers.js';
import { STAGE_LABEL as STAGE_TEXT } from '../workflow/candidates.js';

/** The actor used for public actions. It cannot see salary or documents of anyone else. */
export const CAREERS_ACTOR = { id: null, name: 'Candidate', role: 'CANDIDATE' };

// ---------- careers (public) ----------

export function publishedRoles(db) {
  return helpers(db).all(
    `SELECT id, title, level, location, remote, exp_min AS expMin, exp_max AS expMax,
            must_skills AS mustSkills, good_skills AS goodSkills, jd_text AS jdText, team
       FROM requisitions WHERE status = 'OPEN' AND published = 1 ORDER BY title`,
  ).map((r) => ({ ...r, remote: !!r.remote, mustSkills: JSON.parse(r.mustSkills), goodSkills: JSON.parse(r.goodSkills) }));
}

export function publishedRole(db, id) {
  const r = publishedRoles(db).find((x) => x.id === id);
  if (!r) throw new AppError(404, 'not_found', 'This role is not open for applications.');
  return r;
}

const ApplyInput = z.object({
  name: z.string().trim().min(2, 'Enter your full name.'),
  email: z.string().trim().email('Enter a valid email.').or(z.literal('')).optional().default(''),
  phone: z.string().trim().max(20).optional().default(''),
  experienceYears: z.number().min(0).max(45).nullable().optional(),
  noticeDays: z.number().int().min(0).max(365).nullable().optional(),
  location: z.string().trim().max(80).optional().default(''),
  resumeText: z.string().max(60000).optional().default(''),
  portfolioUrl: z.string().trim().max(200).refine((u) => u === '' || /^https?:\/\//i.test(u), 'Use a full address starting with http:// or https://.').optional().default(''),
  githubUrl: z.string().trim().max(200).refine((u) => u === '' || /^https?:\/\//i.test(u), 'Use a full address starting with http:// or https://.').optional().default(''),
  consent: z.boolean().refine((v) => v === true, 'Please agree to the use of your details for this application.'),
});

/**
 * Public application. If the person already exists, the reply is the same as for a new application,
 * so the form cannot be used to find out who has applied before.
 */
export function applyToRole(db, roleId, body, now) {
  publishedRole(db, roleId);
  const input = ApplyInput.parse(body ?? {});
  if (!input.email && input.phone.replace(/\D/g, '').length < 10) {
    throw rule('Add an email or a 10-digit phone number, so we can reach you.', 'contact_required', { email: 'Add an email or phone number.' });
  }
  try {
    // Matches an existing person: recorded and linked, so HR sees it in the tracker. The reply is the same either way.
    const cand = createCandidate(db, CAREERS_ACTOR, {
      requisitionId: roleId, source: 'Careers page', ...input, confirmDuplicate: true,
    }, now, { via: 'Careers page' });
    const token = helpers(db).one('SELECT token FROM candidates WHERE id = ?', cand.id)?.token ?? null;
    return { received: true, token, statusUrl: token ? `/status/${token}` : null };
  } catch (e) {
    if (e.code === 'duplicate_warning' || e.code === 'cooling_off') {
      // Same reply either way. HR sees the duplicate in the tracker.
      return { received: true, token: null, statusUrl: null };
    }
    throw e;
  }
}

// ---------- candidate portal (by private link) ----------

const PLAIN = {
  SCREENING: 'We are reviewing your application. We will be in touch soon.',
  INTERVIEWS: 'You are moving through the interview rounds. We will contact you to arrange the next one.',
  SELECTED: 'Congratulations, you have been selected.',
  CLOSED: 'This application is now closed. Thank you for your time with us.',
};

function byToken(db, token) {
  const c = helpers(db).one('SELECT * FROM candidates WHERE token = ?', token);
  if (!c) throw notFound('This link is not valid. Ask the recruiter for a new one.');
  return c;
}

export function portalStatus(db, token, now) {
  const c = byToken(db, token);
  const req = helpers(db).one('SELECT title FROM requisitions WHERE id = ?', c.requisition_id);
  const offer = helpers(db).one("SELECT * FROM offers WHERE candidate_id = ? AND status IN ('SENT','NEGOTIATING') ORDER BY version DESC LIMIT 1", c.id);
  let message = PLAIN[c.stage] ?? PLAIN.SCREENING;
  if (c.stage === 'SELECTED' && c.phase === 'PRE_JOINING') {
    message = `Welcome aboard. Please upload the documents below before you join on ${c.join_date}.`;
  } else if (c.stage === 'SELECTED' && c.phase && !['OFFER'].includes(c.phase)) {
    message = 'Welcome! You have joined. Your onboarding is in progress.';
  } else if (c.stage === 'SELECTED' && !offer) {
    message = 'Congratulations, you have been selected. Your offer is being prepared.';
  } else if (c.stage === 'CLOSED' && c.closed_reason === 'Offer declined') {
    message = 'You have declined the offer. Thank you for letting us know.';
  }
  const documents = helpers(db).all(
    `SELECT d.id, d.doc_type AS docType, d.status, d.reason, (f.document_id IS NOT NULL) AS hasFile
       FROM documents d LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.candidate_id = ? ORDER BY d.id`,
    c.id,
  ).map((d) => ({ ...d, hasFile: !!d.hasFile }));
  return {
    firstName: c.name.split(' ')[0],
    role: req.title,
    stageLabel: STAGE_TEXT[c.stage],
    message,
    offer: offer && {
      id: offer.id, ctcLpa: offer.ctc_lpa, joinDate: offer.join_date, expiryDate: offer.expiry_date,
      letter: offer.letter, status: offer.status,
    },
    documents: c.stage === 'CLOSED' ? [] : documents,
    documentsNote: 'Upload a clear photo or PDF for each item. HR checks each one and will tell you if anything needs replacing.',
  };
}

export function portalUpload(db, token, docId, file, now) {
  const c = byToken(db, token);
  const doc = helpers(db).one('SELECT * FROM documents WHERE id = ? AND candidate_id = ?', docId, c.id);
  if (!doc) throw notFound('That document');
  if (doc.status === 'VERIFIED') throw rule('This document has already been checked. No need to upload it again.', 'verified');
  storeDocumentFile(db, docId, file, now, null);
  return portalStatus(db, token, now);
}

const RespondInput = z.object({
  decision: z.enum(['ACCEPT', 'NEGOTIATE', 'DECLINE']),
  signName: z.string().optional(),
  note: z.string().optional(),
});

export function portalRespond(db, token, body, now) {
  const c = byToken(db, token);
  const input = RespondInput.parse(body ?? {});
  const offer = helpers(db).one("SELECT * FROM offers WHERE candidate_id = ? AND status IN ('SENT','NEGOTIATING') ORDER BY version DESC LIMIT 1", c.id);
  if (!offer) throw rule('There is no open offer to respond to.', 'no_offer');
  if (input.decision === 'ACCEPT') acceptOffer(db, CAREERS_ACTOR, offer.id, { signName: input.signName, byCandidate: true }, now);
  else if (input.decision === 'NEGOTIATE') negotiateOffer(db, CAREERS_ACTOR, offer.id, { note: input.note }, now);
  else declineOffer(db, CAREERS_ACTOR, offer.id, { reason: input.note }, now);
  return portalStatus(db, token, now);
}


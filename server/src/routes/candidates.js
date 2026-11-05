import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import { resumeTextFrom } from '../ats/resumeText.js';
import {
  listCandidates, getCandidate, createCandidate, updateCandidate, saveKnockouts, approveNotice, phoneScreen,
  startInterviews, rejectRoute, undoReject, withdraw, talentPool, setHold, assignOwner, addNote, moveJob,
  candidateHistory, bulkReject, bulkAssign, resumeIntakeHint,
} from '../services/candidates.js';
import { PRESETS, presetIds } from '../services/tracker.js';
import { rule, notFound } from '../errors.js';

const idOf = (req) => Number(req.params.id);

/**
 * Parses the list filters from the query string. Empty values mean "no filter".
 * Every filter is applied together, including a ready-made view (view=...).
 */
function listFilters(q) {
  const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const number = (v) => (text(v) && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  const flag = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);
  return {
    q: text(q.q),
    stage: text(q.stage),
    requisitionId: number(q.requisitionId),
    onHold: flag(q.onHold),
    ownerId: number(q.ownerId),
    view: text(q.view),
  };
}

export async function candidateRoutes(app) {
  const now = () => app.clock.now();

  // The candidate list. All filters apply together: search, stage, role, hold, owner and view.
  app.get('/api/candidates', async (req) => {
    const actor = needCan(req, 'candidate.read');
    const f = listFilters(req.query);
    let rows = listCandidates(app.db, actor, {
      q: f.q, stage: f.stage, requisitionId: f.requisitionId, onHold: f.onHold, ownerId: f.ownerId,
    });
    if (f.view) {
      if (!PRESETS.some((p) => p.id === f.view)) throw notFound('That view');
      const ids = presetIds(app.db, f.view, actor, now());
      rows = rows.filter((c) => ids.has(c.id));
    }
    return { candidates: rows };
  });

  // Turns an uploaded resume into text for the form. Scanned files come back empty with a hint.
  app.post('/api/candidates/parse-resume', async (req) => {
    needCan(req, 'candidate.write');
    const file = await req.file();
    if (!file) throw rule('Choose a resume file to upload.', 'no_file');
    const buffer = await file.toBuffer();
    const text = await resumeTextFrom(buffer, file.filename);
    return { text, hint: resumeIntakeHint(text) };
  });

  app.post('/api/candidates', async (req, reply) => {
    const actor = needCan(req, 'candidate.write');
    const candidate = createCandidate(app.db, actor, req.body ?? {}, now());
    reply.status(201);
    return { candidate };
  });

  app.post('/api/candidates/bulk/reject', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({
      ids: z.array(z.number().int()).min(1, 'Select at least one candidate.'),
      reason: z.string().min(3, 'Choose a reason for the rejection.'),
    }).parse(req.body ?? {});
    return bulkReject(app.db, actor, body, now());
  });

  app.post('/api/candidates/bulk/assign', async (req) => {
    const actor = needCan(req, 'candidate.write');
    const body = z.object({
      ids: z.array(z.number().int()).min(1, 'Select at least one candidate.'),
      ownerId: z.number().int('Choose a recruiter.'),
    }).parse(req.body ?? {});
    return bulkAssign(app.db, actor, body, now());
  });

  app.get('/api/candidates/:id', async (req) => {
    const actor = needCan(req, 'candidate.read');
    return { candidate: getCandidate(app.db, actor, idOf(req)) };
  });

  app.patch('/api/candidates/:id', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return { candidate: updateCandidate(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/candidates/:id/knockouts', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return { candidate: saveKnockouts(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/candidates/:id/notice-approval', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return { candidate: approveNotice(app.db, actor, idOf(req), now()) };
  });

  app.post('/api/candidates/:id/phone-screen', async (req) => {
    const actor = needCan(req, 'candidate.write');
    const body = z.object({
      outcome: z.enum(['PASS', 'FAIL'], { errorMap: () => ({ message: 'Choose pass or not pass.' }) }),
      notes: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: phoneScreen(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/candidates/:id/start-interviews', async (req) => {
    const actor = needCan(req, 'round.schedule');
    return { candidate: startInterviews(app.db, actor, idOf(req), now()) };
  });

  app.post('/api/candidates/:id/reject', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({ reason: z.string().min(3, 'Choose a reason for the rejection.') }).parse(req.body ?? {});
    return rejectRoute(app.db, actor, idOf(req), body, now());
  });

  app.post('/api/candidates/:id/undo-reject', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    return { candidate: undoReject(app.db, actor, idOf(req), now()) };
  });

  app.post('/api/candidates/:id/withdraw', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { candidate: withdraw(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/candidates/:id/talent-pool', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({ followUpDate: z.string().optional(), reason: z.string().optional() }).parse(req.body ?? {});
    return { candidate: talentPool(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/candidates/:id/hold', async (req) => {
    const actor = needCan(req, 'candidate.write');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { candidate: setHold(app.db, actor, idOf(req), { onHold: true, reason: body.reason }, now()) };
  });

  app.post('/api/candidates/:id/resume', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return { candidate: setHold(app.db, actor, idOf(req), { onHold: false }, now()) };
  });

  app.post('/api/candidates/:id/assign', async (req) => {
    const actor = needCan(req, 'candidate.write');
    const body = z.object({ ownerId: z.number().int('Choose a recruiter.') }).parse(req.body ?? {});
    return { candidate: assignOwner(app.db, actor, idOf(req), body.ownerId, now()) };
  });

  app.post('/api/candidates/:id/notes', async (req) => {
    const actor = needCan(req, 'candidate.read');
    const body = z.object({ text: z.string().optional() }).parse(req.body ?? {});
    return { candidate: addNote(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/candidates/:id/move-job', async (req) => {
    const actor = needCan(req, 'candidate.write');
    const body = z.object({
      requisitionId: z.number().int('Choose the role to move to.'),
      reason: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: moveJob(app.db, actor, idOf(req), body, now()) };
  });

  app.get('/api/candidates/:id/history', async (req) => {
    const actor = needCan(req, 'candidate.read');
    return candidateHistory(app.db, actor, idOf(req));
  });
}

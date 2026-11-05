import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import {
  scheduleRound, noShow, submitFeedback, resolveDecision, resolveHold, reissueTest, finalDecision,
  declareInterviewConflict, replacePanel, suggestPanel, inviteIcs,
} from '../services/interviews.js';
import { findRoundRow } from '../db/repo/interviews.js';
import { notFound } from '../errors.js';
import { canSee } from '../services/candidates.js';

const idOf = (req) => Number(req.params.roundId);

export async function interviewRoutes(app) {
  const now = () => app.clock.now();

  app.post('/api/rounds/:roundId/schedule', async (req) => {
    const actor = needCan(req, 'round.schedule');
    const body = z.object({
      when: z.string({ required_error: 'Pick a date and time.' }).min(1, 'Pick a date and time.'),
      timeZone: z.string().max(60).optional(),
      link: z.string().max(300).optional(),
      panelIds: z.array(z.number().int()).optional(),
      approveExtraReschedule: z.boolean().optional(),
    }).parse(req.body ?? {});
    return { candidate: scheduleRound(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/rounds/:roundId/no-show', async (req) => {
    const actor = needCan(req, 'round.schedule');
    const body = z.object({ confirmReject: z.boolean().optional() }).parse(req.body ?? {});
    return { candidate: noShow(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/rounds/:roundId/feedback', async (req) => {
    const actor = needCan(req, 'feedback.submit');
    return { candidate: submitFeedback(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/rounds/:roundId/conflict', async (req) => {
    const actor = needCan(req, 'feedback.submit');
    const body = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
    return { candidate: declareInterviewConflict(app.db, actor, idOf(req), body, now()) };
  });

  app.put('/api/rounds/:roundId/panel', async (req) => {
    const actor = needCan(req, 'round.schedule');
    const body = z.object({ userIds: z.array(z.number().int()).min(1, 'Choose at least one interviewer.') }).parse(req.body ?? {});
    return { candidate: replacePanel(app.db, actor, idOf(req), body, now()) };
  });

  app.get('/api/rounds/:roundId/suggest-panel', async (req) => {
    const actor = needCan(req, 'round.schedule');
    return suggestPanel(app.db, actor, idOf(req));
  });

  app.post('/api/rounds/:roundId/resolve', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({
      outcome: z.enum(['PASS', 'FAIL'], { errorMap: () => ({ message: 'Choose pass or reject.' }) }),
      note: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: resolveDecision(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/rounds/:roundId/resolve-hold', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({
      decision: z.enum(['CONTINUE', 'REJECT'], { errorMap: () => ({ message: 'Choose continue or reject.' }) }),
      note: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: resolveHold(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/rounds/:roundId/reissue-test', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { candidate: reissueTest(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/rounds/:roundId/final', async (req) => {
    const actor = needCan(req, 'candidate.exit');
    const body = z.object({
      decision: z.enum(['APPROVE', 'REJECT'], { errorMap: () => ({ message: 'Choose approve or reject.' }) }),
      comment: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: finalDecision(app.db, actor, idOf(req), body, now()) };
  });

  // Calendar invite the recruiter can attach to the candidate and panel emails.
  app.get('/api/rounds/:roundId/invite.ics', async (req, reply) => {
    const actor = needCan(req, 'candidate.read');
    const round = findRoundRow(app.db, idOf(req));
    if (!round || !canSee(app.db, actor, round.candidate_id)) throw notFound('That interview round');
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="interview-${round.id}.ics"`);
    return inviteIcs(app.db, actor, round.id);
  });
}

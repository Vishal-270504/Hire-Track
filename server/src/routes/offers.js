import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import { can } from '../auth/permissions.js';
import {
  offersFor, createOffer, approveOffer, reviseOffer, acceptOffer, negotiateOffer, declineOffer,
  extendOffer, revokeOffer, backOut,
} from '../services/offers.js';
import {
  ensureDocuments, listDocuments, storeDocumentFile, documentFile, reviewDocument, listBgv, setBgv,
  listTasks, completeTask, addCheckin, listCheckins, changeJoinDate, setPeople, setRelieving,
  joinCandidate, dayOneNoShow,
} from '../services/joining.js';
import { requireCandidate, getCandidate } from '../services/candidates.js';
import { helpers } from '../db/index.js';
import { rule, notFound } from '../errors.js';

const idOf = (req) => Number(req.params.id);
const now = (app) => app.clock.now();

/** The joining view: offers and tasks for anyone on the team; documents and checks for HR only. */
function joiningView(app, actor, candidateId) {
  const cand = requireCandidate(app.db, actor, candidateId);
  const canManage = can(actor.role, 'joining.manage');
  return {
    offers: can(actor.role, 'salary.read') ? offersFor(app.db, candidateId) : undefined,
    tasks: listTasks(app.db, candidateId),
    checkins: listCheckins(app.db, candidateId),
    joinDate: cand.join_date,
    joinDateChanges: cand.join_date_changes,
    buddy: cand.buddy,
    manager: cand.manager,
    relievingStatus: cand.relieving_status,
    relievingDue: cand.relieving_due,
    subjectToBgv: !!cand.subject_to_bgv,
    documents: canManage ? listDocuments(app.db, actor, candidateId, new Date()) : undefined,
    bgv: canManage ? listBgv(app.db, actor, candidateId, new Date()) : undefined,
    phase: cand.phase,
  };
}

export async function offerRoutes(app) {
  // ----- offers -----
  app.get('/api/candidates/:id/offers', async (req) => {
    const actor = needCan(req, 'salary.read');
    requireCandidate(app.db, actor, idOf(req));
    return { offers: offersFor(app.db, idOf(req)) };
  });

  app.post('/api/candidates/:id/offers', async (req, reply) => {
    const actor = needCan(req, 'offer.manage');
    const candidate = createOffer(app.db, actor, idOf(req), req.body ?? {}, now(app));
    reply.status(201);
    return { candidate };
  });

  app.post('/api/offers/:id/approve', async (req) => {
    const actor = needCan(req, 'offer.approve');
    return { candidate: approveOffer(app.db, actor, idOf(req), now(app)) };
  });

  app.post('/api/candidates/:id/offers/revise', async (req) => {
    const actor = needCan(req, 'offer.manage');
    return { candidate: reviseOffer(app.db, actor, idOf(req), req.body ?? {}, now(app)) };
  });

  app.post('/api/offers/:id/accept', async (req) => {
    const actor = needCan(req, 'offer.manage');
    const body = z.object({ signName: z.string().optional() }).parse(req.body ?? {});
    const candidateId = acceptOffer(app.db, actor, idOf(req), body, now(app));
    return { candidate: getCandidate(app.db, actor, candidateId) };
  });

  app.post('/api/offers/:id/negotiate', async (req) => {
    const actor = needCan(req, 'offer.manage');
    const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    return { candidate: negotiateOffer(app.db, actor, idOf(req), body, now(app)) };
  });

  app.post('/api/offers/:id/decline', async (req) => {
    const actor = needCan(req, 'offer.manage');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return declineOffer(app.db, actor, idOf(req), body, now(app));
  });

  app.post('/api/offers/:id/extend', async (req) => {
    const actor = needCan(req, 'offer.manage');
    return { candidate: extendOffer(app.db, actor, idOf(req), now(app)) };
  });

  app.post('/api/candidates/:id/revoke', async (req) => {
    const actor = needCan(req, 'offer.approve');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return revokeOffer(app.db, actor, idOf(req), body, now(app));
  });

  app.post('/api/candidates/:id/backed-out', async (req) => {
    const actor = needCan(req, 'offer.manage');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return backOut(app.db, actor, idOf(req), body, now(app));
  });

  // ----- joining -----
  app.get('/api/candidates/:id/joining', async (req) => {
    const actor = needCan(req, 'joining.view');
    return joiningView(app, actor, idOf(req));
  });

  app.post('/api/candidates/:id/documents/:docId/upload', async (req) => {
    const actor = needCan(req, 'joining.manage');
    const file = await req.file();
    if (!file) throw rule('Choose a file to upload.', 'no_file');
    const data = await file.toBuffer();
    const doc = helpers(app.db).one('SELECT candidate_id FROM documents WHERE id = ?', Number(req.params.docId));
    if (!doc || doc.candidate_id !== idOf(req)) throw notFound('That document');
    storeDocumentFile(app.db, Number(req.params.docId), { filename: file.filename, mime: file.mimetype, data }, now(app), actor);
    return { candidate: getCandidate(app.db, actor, idOf(req)) };
  });

  app.get('/api/documents/:docId/file', async (req, reply) => {
    const actor = needCan(req, 'joining.manage');
    const f = documentFile(app.db, actor, Number(req.params.docId));
    reply.header('content-type', f.mime);
    reply.header('content-disposition', `attachment; filename="${f.filename.replace(/"/g, '')}"`);
    return Buffer.from(f.data);
  });

  app.post('/api/documents/:docId/review', async (req) => {
    const actor = needCan(req, 'joining.manage');
    return { candidate: reviewDocument(app.db, actor, Number(req.params.docId), req.body ?? {}, now(app)) };
  });

  app.put('/api/candidates/:id/bgv', async (req) => {
    const actor = needCan(req, 'joining.manage');
    const body = z.object({
      checkType: z.string(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'CLEAR', 'FLAGGED']),
      note: z.string().optional(),
    }).parse(req.body ?? {});
    return { candidate: setBgv(app.db, actor, idOf(req), body, now(app)) };
  });

  app.post('/api/tasks/:id/done', async (req) => {
    const actor = needCan(req, 'tasks.complete');
    return { candidate: completeTask(app.db, actor, Number(req.params.id), now(app)) };
  });

  app.post('/api/candidates/:id/checkins', async (req) => {
    const actor = needCan(req, 'joining.view');
    return { candidate: addCheckin(app.db, actor, idOf(req), req.body ?? {}, now(app)) };
  });

  app.post('/api/candidates/:id/join-date', async (req) => {
    const actor = needCan(req, 'joining.manage');
    return { candidate: changeJoinDate(app.db, actor, idOf(req), req.body ?? {}, now(app)) };
  });

  app.post('/api/candidates/:id/people', async (req) => {
    const actor = needCan(req, 'joining.view');
    const body = z.object({ buddy: z.string().max(80).optional(), manager: z.string().max(80).optional() }).parse(req.body ?? {});
    return { candidate: setPeople(app.db, actor, idOf(req), body, now(app)) };
  });

  app.post('/api/candidates/:id/relieving', async (req) => {
    const actor = needCan(req, 'joining.manage');
    const body = z.object({ status: z.enum(['RECEIVED', 'LATER']) }).parse(req.body ?? {});
    return { candidate: setRelieving(app.db, actor, idOf(req), body, now(app)) };
  });

  app.post('/api/candidates/:id/join', async (req) => {
    const actor = needCan(req, 'joining.manage');
    const body = z.object({ subjectToBgv: z.boolean().optional(), relievingLater: z.boolean().optional() }).parse(req.body ?? {});
    return { candidate: joinCandidate(app.db, actor, idOf(req), body, now(app)) };
  });

  app.post('/api/candidates/:id/day-one-no-show', async (req) => {
    const actor = needCan(req, 'joining.manage');
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { candidate: dayOneNoShow(app.db, actor, idOf(req), body, now(app)) };
  });

  // Documents and checks are created on first view, so the checklist is always complete.
  app.get('/api/candidates/:id/checklists', async (req) => {
    const actor = needCan(req, 'joining.manage');
    requireCandidate(app.db, actor, idOf(req));
    ensureDocuments(app.db, idOf(req), now(app));
    return { documents: listDocuments(app.db, actor, idOf(req), now(app)), bgv: listBgv(app.db, actor, idOf(req), now(app)) };
  });

}

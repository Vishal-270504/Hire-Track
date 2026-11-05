import { z } from 'zod';
import { needCan, needUser } from '../auth/guard.js';
import { listRequisitions, approverOptions } from '../db/repo/requisitions.js';
import { ROUND_TEMPLATES } from '../policy/templates.js';
import { REQ_STATUS } from '../workflow/requisitions.js';
import {
  getRequisition, createRequisition, updateRequisition, deleteDraft, savePlan, applyTemplate,
  copyPlan, submitForApproval, decideApproval, changeStatus,
} from '../services/requisitions.js';
import { auditTrail } from '../audit/index.js';
import { rule } from '../errors.js';

const idParam = (req) => Number(req.params.id);

export async function requisitionRoutes(app) {
  const now = () => app.clock.now();

  app.get('/api/requisitions', async (req) => {
    needCan(req, 'requisition.read');
    const status = req.query.status;
    if (status && !Object.keys(REQ_STATUS).includes(status)) throw rule('Unknown status filter.', 'bad_filter');
    return { requisitions: listRequisitions(app.db, { status }) };
  });

  app.post('/api/requisitions', async (req, reply) => {
    const actor = needCan(req, 'requisition.write');
    const requisition = createRequisition(app.db, actor, req.body ?? {}, now());
    reply.status(201);
    return { requisition };
  });

  app.get('/api/requisitions/approver-options', async (req) => {
    needCan(req, 'requisition.write');
    return { approvers: approverOptions(app.db) };
  });

  app.get('/api/requisition-templates', async (req) => {
    needCan(req, 'requisition.read');
    return { templates: ROUND_TEMPLATES.map(({ id, name, description, rounds }) => ({ id, name, description, roundCount: rounds.length })) };
  });

  app.get('/api/requisitions/:id', async (req) => {
    needCan(req, 'requisition.read');
    return { requisition: getRequisition(app.db, idParam(req)) };
  });

  app.patch('/api/requisitions/:id', async (req) => {
    const actor = needCan(req, 'requisition.write');
    return { requisition: updateRequisition(app.db, actor, idParam(req), req.body ?? {}, now()) };
  });

  app.delete('/api/requisitions/:id', async (req, reply) => {
    const actor = needCan(req, 'requisition.write');
    deleteDraft(app.db, actor, idParam(req), now());
    reply.status(204);
    return null;
  });

  app.put('/api/requisitions/:id/plan', async (req) => {
    const actor = needCan(req, 'requisition.write');
    return { requisition: savePlan(app.db, actor, idParam(req), req.body ?? {}, now()) };
  });

  app.post('/api/requisitions/:id/plan/template', async (req) => {
    const actor = needCan(req, 'requisition.write');
    const { templateId } = z.object({ templateId: z.string().min(1, 'Choose a plan template.') }).parse(req.body ?? {});
    return { requisition: applyTemplate(app.db, actor, idParam(req), templateId, now()) };
  });

  app.post('/api/requisitions/:id/plan/copy', async (req) => {
    const actor = needCan(req, 'requisition.write');
    const { fromId } = z.object({ fromId: z.number().int('Choose a role to copy from.') }).parse(req.body ?? {});
    return { requisition: copyPlan(app.db, actor, idParam(req), fromId, now()) };
  });

  app.post('/api/requisitions/:id/submit', async (req) => {
    const actor = needCan(req, 'requisition.write');
    const { approvers } = z.object({
      approvers: z.array(z.object({ label: z.string(), approverId: z.number().int() })).default([]),
    }).parse(req.body ?? {});
    return { requisition: submitForApproval(app.db, actor, idParam(req), approvers, now()) };
  });

  app.post('/api/requisitions/:id/approvals/:stepId/decide', async (req) => {
    const actor = needUser(req);
    const body = z.object({
      decision: z.enum(['APPROVE', 'REJECT'], { errorMap: () => ({ message: 'Choose approve or not approve.' }) }),
      comment: z.string().max(1000).optional(),
    }).parse(req.body ?? {});
    return { requisition: decideApproval(app.db, actor, idParam(req), Number(req.params.stepId), body, now()) };
  });

  app.post('/api/requisitions/:id/hold', async (req) => {
    const actor = needCan(req, 'requisition.write');
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { requisition: changeStatus(app.db, actor, idParam(req), REQ_STATUS.ON_HOLD, reason, now()) };
  });

  app.post('/api/requisitions/:id/reopen', async (req) => {
    const actor = needCan(req, 'requisition.write');
    return { requisition: changeStatus(app.db, actor, idParam(req), REQ_STATUS.OPEN, null, now()) };
  });

  app.post('/api/requisitions/:id/close', async (req) => {
    const actor = needCan(req, 'requisition.write');
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return { requisition: changeStatus(app.db, actor, idParam(req), REQ_STATUS.CLOSED, reason, now()) };
  });

  app.get('/api/requisitions/:id/history', async (req) => {
    needCan(req, 'requisition.read');
    return { history: auditTrail(app.db, 'requisition', idParam(req)) };
  });
}

import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import {
  probationTracker, employeeDetail, setOnboardingItem, recordAsset, returnAsset, submitReview, approveReview,
  startPipRoute, pipCheckin, closePip, confirmEmployee, extendEmployee, separateEmployee, recordSurvey,
  addGoal, letterText,
} from '../services/employees.js';
import { helpers } from '../db/index.js';
import { notFound } from '../errors.js';

const idOf = (req) => Number(req.params.id);

export async function employeeRoutes(app) {
  const now = () => app.clock.now();

  app.get('/api/employees', async (req) => {
    needCan(req, 'probation.read');
    return { employees: probationTracker(app.db) };
  });

  app.get('/api/employees/:id', async (req) => {
    const actor = needCan(req, 'probation.read');
    return { employee: employeeDetail(app.db, actor, idOf(req)) };
  });

  app.post('/api/employees/:id/items/:key', async (req) => {
    const actor = needCan(req, 'onboarding.manage');
    const body = z.object({ done: z.boolean() }).parse(req.body ?? {});
    return { employee: setOnboardingItem(app.db, actor, idOf(req), { itemKey: req.params.key, done: body.done }, now()) };
  });

  app.post('/api/employees/:id/assets', async (req, reply) => {
    const actor = needCan(req, 'onboarding.manage');
    const body = z.object({
      assetType: z.string(),
      serial: z.string().max(80).optional(),
      loaner: z.boolean().optional(),
    }).parse(req.body ?? {});
    reply.status(201);
    return { employee: recordAsset(app.db, actor, idOf(req), body, now()) };
  });

  app.post('/api/assets/:id/return', async (req) => {
    const actor = needCan(req, 'onboarding.manage');
    return { employee: returnAsset(app.db, actor, Number(req.params.id), now()) };
  });

  app.post('/api/employees/:id/goals', async (req, reply) => {
    const actor = needCan(req, 'probation.manage');
    reply.status(201);
    return { employee: addGoal(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/employees/:id/reviews', async (req, reply) => {
    const actor = needCan(req, 'probation.manage');
    reply.status(201);
    return { employee: submitReview(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/employees/:id/reviews/:period/approve', async (req) => {
    const actor = needCan(req, 'probation.manage');
    return { employee: approveReview(app.db, actor, idOf(req), req.params.period, now()) };
  });

  app.post('/api/employees/:id/pip', async (req, reply) => {
    const actor = needCan(req, 'probation.manage');
    reply.status(201);
    return { employee: startPipRoute(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/pips/:id/checkins', async (req) => {
    const actor = needCan(req, 'probation.manage');
    return { employee: pipCheckin(app.db, actor, Number(req.params.id), req.body ?? {}, now()) };
  });

  app.post('/api/pips/:id/close', async (req) => {
    const actor = needCan(req, 'probation.manage');
    const pip = helpers(app.db).one('SELECT employee_id FROM pips WHERE id = ?', Number(req.params.id));
    if (!pip) throw notFound('That plan');
    return { employee: closePip(app.db, actor, Number(req.params.id), req.body ?? {}, now()) };
  });

  app.post('/api/employees/:id/confirm', async (req) => {
    const actor = needCan(req, 'probation.manage');
    return { employee: confirmEmployee(app.db, actor, idOf(req), now()) };
  });

  app.post('/api/employees/:id/extend', async (req) => {
    const actor = needCan(req, 'probation.manage');
    return { employee: extendEmployee(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/employees/:id/separate', async (req) => {
    const actor = needCan(req, 'probation.manage');
    return { employee: separateEmployee(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.post('/api/employees/:id/surveys', async (req, reply) => {
    const actor = needCan(req, 'probation.manage');
    reply.status(201);
    return { employee: recordSurvey(app.db, actor, idOf(req), req.body ?? {}, now()) };
  });

  app.get('/api/employees/:id/letters/:kind', async (req) => {
    needCan(req, 'probation.read');
    return { kind: req.params.kind, text: letterText(app.db, idOf(req), req.params.kind) };
  });
}

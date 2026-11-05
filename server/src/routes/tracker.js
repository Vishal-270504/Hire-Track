import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import { boardData, boardMove, reportSummary, PRESETS, presetIds, listViews, createView, deleteView, candidatesWorkbook, auditCsv, anonymise } from '../services/tracker.js';
import { listCandidates } from '../services/candidates.js';
import { findRequisitionRow } from '../db/repo/requisitions.js';
import { helpers } from '../db/index.js';
import { rule, notFound } from '../errors.js';

export async function trackerRoutes(app) {
  const now = () => app.clock.now();

  app.get('/api/board', async (req) => {
    const actor = needCan(req, 'candidate.read');
    return { columns: boardData(app.db, actor) };
  });

  app.post('/api/candidates/:id/board-move', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return { candidate: boardMove(app.db, actor, Number(req.params.id), req.body ?? {}, now()) };
  });

  app.get('/api/reports/summary', async (req) => {
    needCan(req, 'reports.read');
    return reportSummary(app.db, now());
  });

  // Tracker list with a ready-made view or the saved filters. Views are applied after the query.
  app.get('/api/candidates/view', async (req) => {
    const actor = needCan(req, 'candidate.read');
    const view = req.query.view;
    if (!PRESETS.find((p) => p.id === view)) throw notFound('That view');
    const ids = presetIds(app.db, view, actor, now());
    return { candidates: listCandidates(app.db, actor, {}).filter((c) => ids.has(c.id)) };
  });

  app.get('/api/views', async (req) => {
    const actor = needCan(req, 'candidate.read');
    return { presets: PRESETS, saved: listViews(app.db, actor) };
  });

  app.post('/api/views', async (req, reply) => {
    const actor = needCan(req, 'candidate.write');
    reply.status(201);
    return { view: createView(app.db, actor, req.body ?? {}, now()) };
  });

  app.delete('/api/views/:id', async (req) => {
    const actor = needCan(req, 'candidate.write');
    return deleteView(app.db, actor, Number(req.params.id));
  });

  app.get('/api/candidates/export.xlsx', async (req, reply) => {
    const actor = needCan(req, 'reports.read');
    const q = req.query ?? {};
    const buf = candidatesWorkbook(app.db, actor, {
      stage: q.stage || undefined,
      requisitionId: q.requisitionId ? Number(q.requisitionId) : undefined,
      onHold: q.onHold === undefined ? undefined : q.onHold === 'true',
    });
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', 'attachment; filename="hiretrack-candidates.xlsx"');
    return buf;
  });

  app.get('/api/audit/export.csv', async (req, reply) => {
    needCan(req, 'audit.read');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="hiretrack-audit.csv"');
    return auditCsv(app.db);
  });

  app.post('/api/candidates/:id/anonymise', async (req) => {
    const actor = needCan(req, 'candidate.anonymise');
    return anonymise(app.db, actor, Number(req.params.id), now());
  });

  app.post('/api/requisitions/:id/publish', async (req) => {
    needCan(req, 'requisition.write');
    const body = z.object({ published: z.boolean() }).parse(req.body ?? {});
    const row = findRequisitionRow(app.db, Number(req.params.id));
    if (!row) throw notFound('That role');
    if (body.published && row.status !== 'OPEN') throw rule('Only an open role can be published to the careers page.', 'not_open');
    helpers(app.db).run('UPDATE requisitions SET published = ? WHERE id = ?', body.published ? 1 : 0, row.id);
    return { published: body.published };
  });
}

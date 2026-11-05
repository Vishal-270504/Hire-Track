import { z } from 'zod';
import * as XLSX from 'xlsx';
import { rule, notFound, forbidden } from '../errors.js';
import { audit, auditTrail } from '../audit/index.js';
import { helpers } from '../db/index.js';
import { listCandidates, undoReject, startInterviews, requireCandidate } from './candidates.js';

const iso = (d) => d.toISOString();

// ---------- board ----------

export const COLUMNS = [
  { key: 'SCREENING', label: 'Screening' },
  { key: 'INTERVIEWS', label: 'Interviews' },
  { key: 'OFFER', label: 'Offer' },
  { key: 'PRE_JOINING', label: 'Pre-joining' },
  { key: 'ONBOARDING', label: 'Joined, onboarding' },
  { key: 'PROBATION', label: 'Probation' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'CLOSED', label: 'Closed' },
];

export function columnOf(c) {
  if (c.stage === 'CLOSED') return 'CLOSED';
  if (c.stage === 'SCREENING') return 'SCREENING';
  if (c.stage === 'INTERVIEWS') return 'INTERVIEWS';
  return c.phase || 'OFFER';
}

/** Moves a card can make. Only moves with a real action are enabled; the rest say why. */
function movesFor(c, undoable) {
  const col = columnOf(c);
  const moves = COLUMNS.map((t) => ({ to: t.key, enabled: false, reason: '' }));
  const set = (to, enabled, reason = '') => {
    const m = moves.find((x) => x.to === to);
    if (m) Object.assign(m, { enabled, reason });
  };
  if (col === 'SCREENING' && c.status === 'Shortlisted for interviews') set('INTERVIEWS', true);
  else if (col === 'SCREENING') set('INTERVIEWS', false, 'Pass the phone screen first.');
  if (col === 'INTERVIEWS') set('OFFER', false, 'The final approval is given by HR on the last round.');
  if (col === 'CLOSED' && undoable) set('SCREENING', true);
  else if (col === 'CLOSED') set('SCREENING', false, 'Only a rejection inside the undo window can be reversed.');
  for (const t of ['OFFER', 'PRE_JOINING', 'ONBOARDING', 'PROBATION', 'CONFIRMED']) {
    if (!moves.find((m) => m.to === t).reason) set(t, false, 'Use the candidate page for this step, so the right details are recorded.');
  }
  if (col !== 'CLOSED') set('CLOSED', false, 'Reject, withdraw or record the outcome on the candidate page, with a reason.');
  return moves.filter((m) => m.to !== col);
}

export function boardData(db, actor) {
  const cards = listCandidates(db, actor, {});
  const phases = new Map(helpers(db).all('SELECT id, phase, rejected_at, reject_undo_until, closed_reason FROM candidates').map((r) => [r.id, r]));
  const now = Date.now();
  const enriched = cards.map((c) => {
    const row = phases.get(c.id) ?? {};
    const undoable = row.closed_reason === 'Rejected' && row.reject_undo_until && new Date(row.reject_undo_until).getTime() > now;
    const col = columnOf({ ...c, phase: row.phase });
    return {
      id: c.id, name: c.name, requisitionTitle: c.requisitionTitle, atsScore: c.atsScore, status: c.status,
      column: col, stage: c.stage, onHold: c.onHold, nextAction: c.nextAction, ownerName: c.ownerName,
      updatedAt: c.updatedAt, moves: movesFor({ ...c, phase: row.phase }, undoable),
    };
  });
  return COLUMNS.map((col) => ({ ...col, cards: enriched.filter((c) => c.column === col.key) }));
}

const MoveInput = z.object({ to: z.string() });

/** Board moves that have a real action behind them. Anything else must go through the candidate page. */
export function boardMove(db, actor, candidateId, body, now) {
  const { to } = MoveInput.parse(body ?? {});
  const cand = requireCandidate(db, actor, candidateId);
  const row = helpers(db).one('SELECT * FROM candidates WHERE id = ?', candidateId);
  if (to === 'INTERVIEWS' && row.stage === 'SCREENING') return startInterviews(db, actor, candidateId, now);
  if (to === 'SCREENING' && row.stage === 'CLOSED') return undoReject(db, actor, candidateId, now);
  throw rule('That move needs the candidate page, where the reason and details are recorded.', 'use_candidate_page');
}

// ---------- reports ----------

export function reportSummary(db, now = new Date()) {
  const q = (sql, ...a) => helpers(db).one(sql, ...a);
  const thisMonth = iso(now).slice(0, 7);
  const today = iso(now).slice(0, 10);
  const columns = COLUMNS.map((c) => ({ key: c.key, label: c.label, count: 0 }));
  for (const r of helpers(db).all('SELECT stage, phase FROM candidates WHERE anonymised_at IS NULL')) {
    const col = columnOf({ stage: r.stage, phase: r.phase });
    const hit = columns.find((c) => c.key === col);
    if (hit) hit.count += 1;
  }
  const sent = q("SELECT COUNT(DISTINCT candidate_id) AS n FROM offers WHERE status != 'PENDING_APPROVAL'").n;
  const accepted = q('SELECT COUNT(DISTINCT candidate_id) AS n FROM offers WHERE sign_at IS NOT NULL').n;
  const declines = helpers(db).all(`SELECT closed_reason AS reason, COUNT(*) AS n FROM candidates
      WHERE closed_reason IN ('Offer declined','Backed out','Withdrawn','No-show on Day 1','Offer expired','Offer revoked','Separated during probation')
      GROUP BY closed_reason ORDER BY n DESC`);
  const confirmed = q("SELECT COUNT(*) AS n FROM employees WHERE status = 'CONFIRMED'").n;
  const separated = q("SELECT COUNT(*) AS n FROM employees WHERE status = 'SEPARATED'").n;
  const employees = q('SELECT COUNT(*) AS n FROM employees').n;
  const early = q("SELECT COUNT(*) AS n FROM employees WHERE status = 'SEPARATED' AND julianday(separated_on) - julianday(joined_on) <= 90").n;
  const toHire = q(`SELECT AVG(julianday(e.joined_on) - julianday(c.created_at)) AS d FROM employees e JOIN candidates c ON c.id = e.candidate_id`).d;
  const toFinal = q(`SELECT AVG(julianday(r.approved_at) - julianday(e.joined_on)) AS d FROM reviews r JOIN employees e ON e.id = r.employee_id
                      WHERE r.period = 'FINAL' AND r.status = 'APPROVED'`).d;
  return {
    asOf: today,
    openRoles: q("SELECT COUNT(*) AS n FROM requisitions WHERE status = 'OPEN'").n,
    openings: q("SELECT COALESCE(SUM(headcount),0) AS n FROM requisitions WHERE status = 'OPEN'").n,
    funnel: columns,
    offersPending: q("SELECT COUNT(*) AS n FROM offers WHERE status IN ('PENDING_APPROVAL','SENT','NEGOTIATING')").n,
    interviewsToday: q("SELECT COUNT(*) AS n FROM interview_rounds WHERE status = 'SCHEDULED' AND substr(scheduled_at,1,10) = ?", today).n,
    joinedThisMonth: q('SELECT COUNT(*) AS n FROM employees WHERE substr(joined_on,1,7) = ?', thisMonth).n,
    averageDaysToHire: toHire == null ? null : Math.round(toHire),
    offerAcceptanceRate: sent ? Math.round((accepted / sent) * 100) : null,
    dropouts: declines,
    probationPassRate: confirmed + separated ? Math.round((confirmed / (confirmed + separated)) * 100) : null,
    attrition90Days: employees ? Math.round((early / employees) * 100) : null,
    averageDaysToFinalReview: toFinal == null ? null : Math.round(toFinal),
    definitions: {
      averageDaysToHire: 'Days from adding a candidate to their joining day, averaged over everyone who joined.',
      offerAcceptanceRate: 'Offers signed by the candidate, out of offers sent.',
      probationPassRate: 'Confirmed, out of everyone whose probation has ended in confirmation or separation.',
      attrition90Days: 'Separated within 90 days of joining, out of everyone who joined.',
      averageDaysToFinalReview: 'Days from joining to the approved final review.',
    },
  };
}

// ---------- saved views and ready-made views ----------

export const PRESETS = [
  { id: 'my-actions', label: 'My action items' },
  { id: 'feedback-overdue', label: 'Feedback overdue' },
  { id: 'interviews-week', label: 'Interviews this week' },
  { id: 'offers-awaiting', label: 'Offers awaiting reply' },
  { id: 'joining-month', label: 'Joining this month' },
  { id: 'documents-pending', label: 'Documents pending' },
  { id: 'stuck', label: 'Stuck (no change in 7 days)' },
  { id: 'talent-pool', label: 'Talent pool' },
];

/** Candidate ids that match a ready-made view. */
export function presetIds(db, view, actor, now = new Date()) {
  const today = iso(now).slice(0, 10);
  const week = iso(new Date(now.getTime() + 7 * 86_400_000)).slice(0, 10);
  const weekAgo = iso(new Date(now.getTime() - 7 * 86_400_000));
  const sql = {
    'my-actions': ["SELECT id FROM candidates WHERE owner_id = ? AND stage != 'CLOSED'", [actor.id]],
    'feedback-overdue': ["SELECT DISTINCT candidate_id AS id FROM interview_rounds ir JOIN interview_panel p ON p.interview_round_id = ir.id WHERE ir.status = 'SCHEDULED' AND ir.scheduled_at < ? AND p.submitted_at IS NULL", [iso(now)]],
    'interviews-week': ["SELECT DISTINCT candidate_id AS id FROM interview_rounds WHERE status = 'SCHEDULED' AND substr(scheduled_at,1,10) BETWEEN ? AND ?", [today, week]],
    'offers-awaiting': ["SELECT DISTINCT candidate_id AS id FROM offers WHERE status IN ('PENDING_APPROVAL','SENT','NEGOTIATING')", []],
    'joining-month': ["SELECT id FROM candidates WHERE phase = 'PRE_JOINING' AND substr(join_date,1,7) = ?", [today.slice(0, 7)]],
    'documents-pending': ["SELECT DISTINCT candidate_id AS id FROM documents WHERE status IN ('PENDING','SUBMITTED')", []],
    stuck: ["SELECT id FROM candidates WHERE stage != 'CLOSED' AND updated_at < ?", [weekAgo]],
    'talent-pool': ["SELECT id FROM candidates WHERE status = 'Talent pool'", []],
  }[view];
  if (!sql) throw notFound('That view');
  return new Set(helpers(db).all(sql[0], ...sql[1]).map((r) => r.id));
}

const ViewInput = z.object({
  name: z.string().trim().min(2, 'Name the view.').max(60),
  filters: z.object({
    q: z.string().optional(), stage: z.string().optional(), requisitionId: z.string().optional(),
    onHold: z.string().optional(), view: z.string().optional(),
  }),
  shared: z.boolean().optional(),
});

export function listViews(db, actor) {
  return helpers(db).all(
    `SELECT v.id, v.name, v.filters, v.shared, u.name AS owner FROM saved_views v JOIN users u ON u.id = v.owner_id
      WHERE v.owner_id = ? OR v.shared = 1 ORDER BY v.name`,
    actor.id,
  ).map((v) => ({ ...v, filters: JSON.parse(v.filters), mine: undefined }));
}

export function createView(db, actor, body, now) {
  const input = ViewInput.parse(body ?? {});
  const info = helpers(db).run('INSERT INTO saved_views (owner_id, name, filters, shared, created_at) VALUES (?, ?, ?, ?, ?)',
    actor.id, input.name, JSON.stringify(input.filters), input.shared ? 1 : 0, iso(now));
  return listViews(db, actor).find((v) => v.id === Number(info.lastInsertRowid));
}

export function deleteView(db, actor, id) {
  const v = helpers(db).one('SELECT * FROM saved_views WHERE id = ?', id);
  if (!v) throw notFound('That view');
  if (v.owner_id !== actor.id && actor.role !== 'ADMIN') throw forbidden('Only the owner can delete this view.');
  helpers(db).run('DELETE FROM saved_views WHERE id = ?', id);
  return { ok: true };
}

// ---------- exports ----------

export function candidatesWorkbook(db, actor, filters) {
  const rows = listCandidates(db, actor, filters);
  const data = rows.map((c) => ({
    Name: c.name, Role: c.requisitionTitle, Stage: c.stage, Status: c.status, 'Screening score': c.atsScore == null ? '' : Math.round(c.atsScore),
    'On hold': c.onHold ? 'Yes' : 'No', Owner: c.ownerName ?? '', 'Next step': c.nextAction ?? '', 'Last change': c.updatedAt,
  }));
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Name: '' }]);
  ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 36 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function auditCsv(db) {
  const rows = helpers(db).all(
    `SELECT a.at, u.name AS by_name, a.action, a.entity, a.entity_id, a.reason, a.detail
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id`,
  );
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'at,by,action,entity,entity_id,reason,detail';
  return [header, ...rows.map((r) => [r.at, r.by_name ?? 'System', r.action, r.entity, r.entity_id, r.reason, r.detail].map(esc).join(','))].join('\n');
}

export function candidateAudit(db, actor, id) {
  requireCandidate(db, actor, id);
  return auditTrail(db, 'candidate', id);
}

// ---------- privacy (DPDP): anonymise a closed candidate ----------

export function anonymise(db, actor, candidateId, now) {
  const cand = requireCandidate(db, actor, candidateId);
  if (cand.stage !== 'CLOSED') throw rule('Only a closed candidate can be anonymised. Close them first.', 'not_closed');
  if (cand.anonymised_at) throw rule('This record is already anonymised.', 'already');
  const label = `Anonymised candidate ${candidateId}`;
  const at = iso(now);
  helpers(db).tx(() => {
    helpers(db).run('DELETE FROM document_files WHERE document_id IN (SELECT id FROM documents WHERE candidate_id = ?)', candidateId);
    helpers(db).run('UPDATE documents SET note = NULL, reason = NULL WHERE candidate_id = ?', candidateId);
    helpers(db).run("UPDATE candidate_events SET text = 'Removed on request (anonymised)' WHERE candidate_id = ? AND kind = 'note'", candidateId);
    helpers(db).run("UPDATE checkins SET note = 'Removed (anonymised)' WHERE candidate_id = ?", candidateId);
    helpers(db).run("UPDATE candidate_events SET text = 'Removed on request (anonymised)' WHERE candidate_id = ?", candidateId);
    helpers(db).run("UPDATE offers SET sign_name = NULL, letter = '', response_note = NULL WHERE candidate_id = ?", candidateId);
    helpers(db).run("UPDATE interview_panel SET comments = NULL, conflict_note = NULL, scores = NULL WHERE interview_round_id IN (SELECT id FROM interview_rounds WHERE candidate_id = ?)", candidateId);
    helpers(db).run("UPDATE pip_checkins SET note = 'Removed (anonymised)' WHERE pip_id IN (SELECT p.id FROM pips p JOIN employees e ON e.id = p.employee_id WHERE e.candidate_id = ?)", candidateId);
    helpers(db).run("UPDATE reviews SET lead_comments = '', buddy_comments = '' WHERE employee_id IN (SELECT id FROM employees WHERE candidate_id = ?)", candidateId);
    helpers(db).run("UPDATE surveys SET comment = '' WHERE employee_id IN (SELECT id FROM employees WHERE candidate_id = ?)", candidateId);
    helpers(db).run('DELETE FROM reminders WHERE candidate_id = ?', candidateId);
    helpers(db).run("UPDATE employees SET name = ?, company_email = 'anonymised-' || id || '@removed.local' WHERE candidate_id = ?", label, candidateId);
    helpers(db).run(`UPDATE candidates SET name = ?, email = '', phone = '', pan = '', location = '', source_detail = '',
        resume_text = '', portfolio_url = '', github_url = '', phone_screen_notes = '', token = NULL, flags = '[]',
        anonymised_at = ?, updated_at = ? WHERE id = ?`, label, at, at, candidateId);
    helpers(db).run("INSERT INTO candidate_events (candidate_id, at, user_id, kind, text) VALUES (?, ?, ?, 'system', ?)", candidateId, at, actor.id, 'Personal details removed on request. The anonymous record is kept for reports.');
  });
  audit(db, { at, userId: actor.id, action: 'candidate.anonymise', entity: 'candidate', entityId: candidateId });
  return { ok: true, name: label };
}

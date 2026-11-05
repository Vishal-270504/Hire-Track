import { helpers } from '../db/index.js';

/**
 * Writes one row to the audit trail. Every state-changing route calls this, so
 * "who did what, when, and why" is never optional.
 */
export function audit(db, { at, userId = null, action, entity, entityId = null, reason = null, detail = null }) {
  helpers(db).run(
    'INSERT INTO audit_log (at, user_id, action, entity, entity_id, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    at, userId, action, entity, entityId, reason, detail == null ? null : JSON.stringify(detail),
  );
}

/** Full history of one record, newest first, with the person's name. */
export function auditTrail(db, entity, entityId) {
  return helpers(db).all(
    `SELECT a.id, a.at, a.action, a.reason, a.detail, u.name AS by_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = ? AND a.entity_id = ?
      ORDER BY a.id DESC`,
    entity, entityId,
  ).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

/**
 * One error type for every expected failure. The message is written for HR, not developers,
 * and `code` lets the UI pick the right next step.
 *   422 rule blocked the action (with a fix the user can take)
 *   403 role not allowed    401 not signed in    404 not found
 *   409 someone else changed the record        400 bad input
 */
export class AppError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const rule = (message, code = 'rule_blocked', fields = {}) => new AppError(422, code, message, fields);
export const notFound = (what = 'That record') => new AppError(404, 'not_found', `${what} was not found.`);
export const forbidden = (message = 'Your role cannot do this.') => new AppError(403, 'forbidden', message);
export const unauthorised = () => new AppError(401, 'unauthorised', 'Please sign in to continue.');
export const stale = () =>
  new AppError(409, 'stale', 'Someone else changed this record while you were editing. Reload to see their changes.');

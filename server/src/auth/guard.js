import { sessionUser } from './session.js';
import { can } from './permissions.js';
import { unauthorised, forbidden } from '../errors.js';

export const COOKIE = 'ht_session';

/** Adds req.user (or null) to every request. Routes then call needUser / needCan. */
export function attachUser(app) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[COOKIE];
    req.user = token ? sessionUser(app.db, token, app.clock.now()) : null;
  });
}

export function needUser(req) {
  if (!req.user) throw unauthorised();
  return req.user;
}

export function needCan(req, action) {
  const user = needUser(req);
  if (!can(user.role, action)) throw forbidden();
  return user;
}

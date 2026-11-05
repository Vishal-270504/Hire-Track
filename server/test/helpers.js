import { openDb } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { fixedClock } from '../src/clock.js';
import { createUser } from '../src/db/repo/users.js';
import { createSession } from '../src/auth/session.js';

export const PASSWORD = 'correct-horse-battery';
export const START = '2026-11-05T09:00:00.000Z';

/**
 * A fresh app on an in-memory database with a movable clock.
 *   h.anon                 -> client with no cookie
 *   h.as('HR')             -> client signed in as a new HR user
 *   h.person('ADMIN')      -> a new user record (with token) without a client
 * Every client method takes (url, body) and returns the injected response.
 */
export async function harness() {
  const db = openDb(':memory:');
  const clock = fixedClock(START);
  const app = await buildApp({ db, clock, sessionSecret: 'test-secret' });
  let n = 0;

  function person(role, name) {
    n += 1;
    const user = createUser(db, {
      name: name ?? `${role} tester ${n}`,
      email: `${role.toLowerCase()}${n}@test.local`,
      password: PASSWORD,
      role,
    }, clock.now().toISOString());
    const { token } = createSession(db, user.id, clock.now());
    return { ...user, token };
  }

  function client(who) {
    const headers = who ? { cookie: `ht_session=${who.token}` } : {};
    const send = (method) => (url, body) =>
      app.inject({ method, url, headers, payload: body });
    return {
      get: send('GET'),
      post: send('POST'),
      patch: send('PATCH'),
      put: send('PUT'),
      delete: send('DELETE'),
    };
  }

  return {
    app, db, clock, person,
    anon: client(null),
    as: (role, name) => client(person(role, name)),
    client,
  };
}

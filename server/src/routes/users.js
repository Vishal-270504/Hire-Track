import { z } from 'zod';
import { needCan } from '../auth/guard.js';
import { ROLES } from '../auth/permissions.js';
import {
  listUsers, createUser, updateUser, findUserById, findUserByEmail, countActiveAdmins,
} from '../db/repo/users.js';
import { audit } from '../audit/index.js';
import { rule, notFound } from '../errors.js';

const CreateBody = z.object({
  name: z.string().trim().min(2, 'Enter a full name.'),
  email: z.string().trim().email('Enter a valid work email.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose a role.' }) }),
});

const PatchBody = z.object({
  name: z.string().trim().min(2, 'Enter a full name.').optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

export async function userRoutes(app) {
  // Names only (no emails or access details), for pickers such as choosing interviewers.
  app.get('/api/people', async (req) => {
    needCan(req, 'candidate.write');
    return { people: app.db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('HR','RECRUITER','INTERVIEWER','ADMIN') ORDER BY name").all() };
  });

  app.get('/api/users', async (req) => {
    needCan(req, 'users.manage');
    return { users: listUsers(app.db) };
  });

  app.post('/api/users', async (req, reply) => {
    const actor = needCan(req, 'users.manage');
    const body = CreateBody.parse(req.body ?? {});
    if (findUserByEmail(app.db, body.email)) {
      throw rule('That email already has an account.', 'duplicate');
    }
    const now = app.clock.now();
    const user = createUser(app.db, body, now.toISOString());
    audit(app.db, {
      at: now.toISOString(), userId: actor.id, action: 'user.create', entity: 'user', entityId: user.id,
      detail: { role: user.role },
    });
    reply.status(201);
    return { user };
  });

  app.patch('/api/users/:id', async (req) => {
    const actor = needCan(req, 'users.manage');
    const id = Number(req.params.id);
    const current = findUserById(app.db, id);
    if (!current) throw notFound('That user');
    const body = PatchBody.parse(req.body ?? {});

    const removesAdmin = current.role === 'ADMIN' && ((body.role && body.role !== 'ADMIN') || body.active === false);
    if (removesAdmin && countActiveAdmins(app.db) <= 1) {
      throw rule('There must always be at least one active admin. Make someone else admin first.', 'last_admin');
    }
    if (actor.id === id && removesAdmin) {
      throw rule('You cannot remove your own admin access. Ask another admin to do it.', 'self_lock');
    }

    const user = updateUser(app.db, id, body);
    const now = app.clock.now().toISOString();
    audit(app.db, {
      at: now, userId: actor.id, action: 'user.update', entity: 'user', entityId: id,
      detail: { before: { role: current.role, active: !!current.active }, after: body },
    });
    return { user };
  });
}

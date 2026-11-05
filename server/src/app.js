import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { systemClock } from './clock.js';
import { attachUser } from './auth/guard.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { requisitionRoutes } from './routes/requisitions.js';
import { settingsRoutes } from './routes/settings.js';
import { candidateRoutes } from './routes/candidates.js';
import { interviewRoutes } from './routes/interviews.js';
import { reminderRoutes } from './routes/reminders.js';
import { offerRoutes } from './routes/offers.js';
import { employeeRoutes } from './routes/employees.js';
import { trackerRoutes } from './routes/tracker.js';
import { publicRoutes } from './routes/public.js';
import multipart from '@fastify/multipart';

/**
 * Builds the HTTP app. Nothing here listens on a port, so tests call app.inject().
 * app.routes records every registered route; the coverage test checks each one has a test.
 */
export async function buildApp({ db, clock = systemClock, sessionSecret = process.env.SESSION_SECRET } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('routes', []);
  app.addHook('onRoute', (r) => {
    if (r.method === 'HEAD' || r.method === 'OPTIONS') return;
    app.routes.push({ method: r.method, url: r.url });
  });

  await app.register(cookie, { secret: sessionSecret ?? 'dev-only-change-me' });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  attachUser(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: err.message, code: err.code, fields: err.fields, details: err.details ?? null });
    }
    if (err instanceof ZodError) {
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message]));
      return reply.status(400).send({ error: 'Please check the highlighted fields.', code: 'validation', fields });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.message, code: 'bad_request', fields: {} });
    }
    console.error(`[${req.method} ${req.url}]`, err);
    return reply.status(500).send({ error: 'Something went wrong. Please try again.', code: 'server_error', fields: {} });
  });

  app.get('/api/health', async () => ({ ok: true, at: clock.now().toISOString() }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(requisitionRoutes);
  await app.register(settingsRoutes);
  await app.register(candidateRoutes);
  await app.register(interviewRoutes);
  await app.register(reminderRoutes);
  await app.register(offerRoutes);
  await app.register(employeeRoutes);
  await app.register(trackerRoutes);
  await app.register(publicRoutes);

  return app;
}

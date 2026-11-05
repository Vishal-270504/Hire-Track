import { publishedRoles, publishedRole, applyToRole, portalStatus, portalUpload, portalRespond } from '../services/portal.js';
import { rule } from '../errors.js';
import { resumeTextFrom } from '../ats/resumeText.js';
import { resumeIntakeHint } from '../services/candidates.js';

/**
 * Public routes: no sign-in. They are rate limited per address, and they only ever return
 * the public fields. The candidate portal is opened with a private link (the token).
 */
export async function publicRoutes(app) {
  const hits = new Map();
  const limited = (req, max = 20, windowMs = 3_600_000) => {
    const key = `${req.ip}:${req.routeOptions?.url ?? req.url.split('?')[0]}`;
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) throw rule('Too many attempts from this connection. Try again later.', 'rate_limited');
    list.push(now);
    hits.set(key, list);
  };
  const now = () => app.clock.now();

  app.get('/api/careers', async () => ({ roles: publishedRoles(app.db) }));

  app.post('/api/careers/parse-resume', async (req) => {
    limited(req, 20);
    const file = await req.file();
    if (!file) throw rule('Choose a resume file to upload.', 'no_file');
    const text = await resumeTextFrom(await file.toBuffer(), file.filename);
    return { text, hint: resumeIntakeHint(text) };
  });

  app.get('/api/careers/:id', async (req) => ({ role: publishedRole(app.db, Number(req.params.id)) }));

  app.post('/api/careers/:id/apply', async (req, reply) => {
    limited(req, 30);
    reply.status(201);
    return applyToRole(app.db, Number(req.params.id), req.body ?? {}, now());
  });

  app.get('/api/portal/:token', async (req) => portalStatus(app.db, req.params.token, now()));

  app.post('/api/portal/:token/documents/:docId', async (req) => {
    limited(req, 60);
    const file = await req.file();
    if (!file) throw rule('Choose a file to upload.', 'no_file');
    const data = await file.toBuffer();
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
    if (!allowed.includes(file.mimetype)) throw rule('Upload a PDF, PNG, JPG or text file.', 'bad_type');
    return portalUpload(app.db, req.params.token, Number(req.params.docId), { filename: file.filename, mime: file.mimetype, data }, now());
  });

  app.post('/api/portal/:token/respond', async (req) => {
    limited(req, 30);
    return portalRespond(app.db, req.params.token, req.body ?? {}, now());
  });
}

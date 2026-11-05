import { needUser } from '../auth/guard.js';
import { runReminders, remindersFor, markDone } from '../reminders/engine.js';
import { notFound } from '../errors.js';

export async function reminderRoutes(app) {
  // Reminders are generated on every read as well as on a timer, so the list is never stale.
  app.get('/api/reminders', async (req) => {
    const user = needUser(req);
    runReminders(app.db, app.clock.now());
    const items = remindersFor(app.db, user);
    return { reminders: items, count: items.length };
  });

  app.post('/api/reminders/:id/done', async (req) => {
    const user = needUser(req);
    const ok = markDone(app.db, user, Number(req.params.id), app.clock.now().toISOString());
    if (!ok) throw notFound('That reminder');
    return { ok: true };
  });

  // The daily digest: what needs attention, grouped by when it is due.
  app.get('/api/digest', async (req) => {
    const user = needUser(req);
    runReminders(app.db, app.clock.now());
    const now = app.clock.now().getTime();
    const items = remindersFor(app.db, user);
    const endOfDay = new Date(app.clock.now()); endOfDay.setHours(23, 59, 59, 999);
    const group = { overdue: [], today: [], later: [] };
    for (const r of items) {
      const due = new Date(r.due_at).getTime();
      if (due < now) group.overdue.push(r);
      else if (due <= endOfDay.getTime()) group.today.push(r);
      else group.later.push(r);
    }
    return { groups: group, count: items.length };
  });
}

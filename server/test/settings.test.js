import { describe, it, expect } from 'vitest';
import { harness } from './helpers.js';
import { policy } from '../src/policy/index.js';
import { DEFAULTS } from '../src/policy/defaults.js';

describe('policy settings (Admin and HR)', () => {
  it('anyone signed in can read the settings with the PDF defaults shown', async () => {
    const h = await harness();
    const res = await h.as('INTERVIEWER').get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json().values.ats.shortlistAt).toBe(75);
    expect(res.json().customised).toEqual([]);
  });

  it('anonymous visitors cannot read the settings', async () => {
    const h = await harness();
    expect((await h.anon.get('/api/settings')).statusCode).toBe(401);
  });

  it('a recruiter cannot change settings; HR can', async () => {
    const h = await harness();
    const block = { ...DEFAULTS.notice, maxDays: 60 };
    expect((await h.as('RECRUITER').put('/api/settings/notice', block)).statusCode).toBe(403);
    expect((await h.as('HR').put('/api/settings/notice', block)).statusCode).toBe(200);
  });

  it('saves a valid change and the engine reads it straight away', async () => {
    const h = await harness();
    const hr = h.as('HR');
    const res = await hr.put('/api/settings/ats', {
      ...DEFAULTS.ats,
      shortlistAt: 80,
      weights: { mustHave: 35, experience: 25, goodToHave: 15, education: 10, stability: 15 },
    });
    expect(res.statusCode).toBe(200);
    expect(policy(h.db, 'ats.shortlistAt')).toBe(80);
    expect(policy(h.db, 'ats.weights.stability')).toBe(15);
    expect((await hr.get('/api/settings')).json().customised).toContain('ats');
  });

  it('the ATS weights must add up to exactly 100, and the message says so', async () => {
    const h = await harness();
    const res = await h.as('HR').put('/api/settings/ats', {
      ...DEFAULTS.ats,
      weights: { mustHave: 50, experience: 25, goodToHave: 15, education: 10, stability: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.weights).toMatch(/add up to exactly 100/);
    expect(policy(h.db, 'ats.weights.mustHave')).toBe(40); // nothing saved
  });

  it('manual review must start below the shortlist mark', async () => {
    const h = await harness();
    const res = await h.as('HR').put('/api/settings/ats', { ...DEFAULTS.ats, reviewAt: 80, shortlistAt: 75 });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.reviewAt).toMatch(/below the shortlist/);
  });

  it('escalation must come after the feedback deadline', async () => {
    const h = await harness();
    const res = await h.as('HR').put('/api/settings/interviews', { ...DEFAULTS.interviews, feedbackHours: 48, feedbackEscalateHours: 24 });
    expect(res.json().fields.feedbackEscalateHours).toMatch(/after the feedback deadline/);
  });

  it('probation criteria weights must add up to 100 and the pass mark must sit above the PIP mark', async () => {
    const h = await harness();
    const badWeights = await h.as('HR').put('/api/settings/probation', {
      ...DEFAULTS.probation,
      criteria: DEFAULTS.probation.criteria.map((c, i) => (i === 0 ? { ...c, weight: 40 } : c)),
    });
    expect(badWeights.statusCode).toBe(400);
    const badMarks = await h.as('HR').put('/api/settings/probation', { ...DEFAULTS.probation, pipAt: 3.5, confirmAt: 3 });
    expect(badMarks.json().fields.pipAt).toMatch(/below the confirmation mark/);
  });

  it('a checklist cannot be emptied', async () => {
    const h = await harness();
    const res = await h.as('HR').put('/api/settings/checklists', { ...DEFAULTS.checklists, documents: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.documents).toMatch(/at least one document/);
  });

  it('an unknown settings area is a 404', async () => {
    const h = await harness();
    expect((await h.as('HR').put('/api/settings/made-up', {})).statusCode).toBe(404);
  });

  it('reset restores the PDF value for that area only', async () => {
    const h = await harness();
    const hr = h.as('HR');
    await hr.put('/api/settings/notice', { maxDays: 45, buyoutAllowed: false });
    await hr.put('/api/settings/reapplyCoolingDays', 90);
    const res = await hr.post('/api/settings/notice/reset', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toEqual(DEFAULTS.notice);
    expect(policy(h.db, 'notice.maxDays')).toBe(90);
    expect(policy(h.db, 'reapplyCoolingDays')).toBe(90); // untouched area keeps its change
  });

  it('every change writes an audit row naming the area', async () => {
    const h = await harness();
    await h.as('HR').put('/api/settings/notice', { maxDays: 45, buyoutAllowed: true });
    const rows = h.db.prepare("SELECT action, detail FROM audit_log WHERE entity = 'settings'").all();
    expect(rows[0].action).toBe('settings.update');
    expect(JSON.parse(rows[0].detail)).toEqual({ block: 'notice' });
  });
});

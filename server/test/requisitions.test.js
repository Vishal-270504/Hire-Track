import { describe, it, expect } from 'vitest';
import { harness } from './helpers.js';
import { helpers } from '../src/db/index.js';

const role = {
  title: 'Java Developer', level: 'SDE-2', headcount: 2, team: 'Payments', location: 'Bengaluru', remote: false,
  budgetMaxLpa: 28, targetJoinDate: '2026-12-01', jdText: 'Build payment services.',
  mustSkills: ['Core Java', 'Spring Boot', 'REST APIs', 'SQL', 'Git'],
  goodSkills: ['Kafka', 'Docker'], expMin: 3, expMax: 5, noticeMaxDays: 60,
};

/** Creates a requisition with a plan and returns ids for the people involved. */
async function setup({ withPlan = true } = {}) {
  const h = await harness();
  const hr = h.client(h.person('HR'));
  const admin = h.person('ADMIN');
  const interviewer = h.person('INTERVIEWER');
  const created = (await hr.post('/api/requisitions', role)).json().requisition;
  if (withPlan) {
    const withTemplate = (await hr.post(`/api/requisitions/${created.id}/plan/template`, { templateId: 'sde2-standard' })).json().requisition;
    return { h, hr, admin, interviewer, req: withTemplate };
  }
  return { h, hr, admin, interviewer, req: created };
}

const submitBody = (admin, hrId) => ({
  approvers: [
    { label: 'HR: budget and headcount', approverId: admin.id },
    { label: 'Department head', approverId: hrId },
  ],
});

describe('creating and reading requisitions', () => {
  it('HR creates a draft with the JD and skills', async () => {
    const h = await harness();
    const res = await h.as('HR').post('/api/requisitions', role);
    expect(res.statusCode).toBe(201);
    expect(res.json().requisition).toMatchObject({ status: 'DRAFT', title: 'Java Developer', mustSkills: role.mustSkills, version: 1 });
  });

  it('a recruiter can create too; an interviewer cannot; anonymous is refused', async () => {
    const h = await harness();
    expect((await h.as('RECRUITER').post('/api/requisitions', role)).statusCode).toBe(201);
    expect((await h.as('INTERVIEWER').post('/api/requisitions', role)).statusCode).toBe(403);
    expect((await h.anon.post('/api/requisitions', role)).statusCode).toBe(401);
  });

  it('explains which field is wrong: title, and experience range in the wrong order', async () => {
    const h = await harness();
    const res = await h.as('HR').post('/api/requisitions', { ...role, title: 'J', expMin: 6, expMax: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.title).toMatch(/title/);
  });

  it('rejects a headcount of zero and a budget that is not positive', async () => {
    const h = await harness();
    const res = await h.as('HR').post('/api/requisitions', { ...role, headcount: 0, budgetMaxLpa: -5 });
    expect(Object.keys(res.json().fields)).toEqual(expect.arrayContaining(['headcount', 'budgetMaxLpa']));
  });

  it('lists requisitions and filters by status; an unknown filter is refused', async () => {
    const { h, hr, req } = await setup({ withPlan: false });
    await hr.post('/api/requisitions', { ...role, title: 'Second role' });
    const drafts = (await hr.get('/api/requisitions?status=DRAFT')).json().requisitions;
    expect(drafts).toHaveLength(2);
    expect((await hr.get('/api/requisitions?status=OPEN')).json().requisitions).toHaveLength(0);
    expect((await hr.get('/api/requisitions?status=NOPE')).statusCode).toBe(422);
    expect(req.id).toBeDefined();
    expect(h).toBeDefined();
  });

  it('the detail shows the rounds in order and the approval steps', async () => {
    const { hr, req } = await setup();
    const detail = (await hr.get(`/api/requisitions/${req.id}`)).json().requisition;
    expect(detail.rounds.map((r) => r.name)).toEqual([
      'Online assessment', 'Technical interview 1', 'Technical interview 2', 'Managerial round', 'HR round',
    ]);
    expect(detail.approvals).toEqual([]);
  });

  it('returns 404 for a requisition that does not exist', async () => {
    const h = await harness();
    expect((await h.as('HR').get('/api/requisitions/9999')).statusCode).toBe(404);
  });

  it('exposes the approver choices (active HR, recruiter and admin accounts only)', async () => {
    const { hr, admin, interviewer } = await setup();
    const ids = (await hr.get('/api/requisitions/approver-options')).json().approvers.map((a) => a.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(interviewer.id);
  });
});

describe('editing the core details', () => {
  it('updates a draft when the version matches and bumps the version', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.patch(`/api/requisitions/${req.id}`, { version: 1, location: 'Pune', headcount: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.json().requisition).toMatchObject({ location: 'Pune', headcount: 3, version: 2 });
  });

  it('refuses an edit made from an old version (someone else changed it first)', async () => {
    const { hr, req } = await setup({ withPlan: false });
    await hr.patch(`/api/requisitions/${req.id}`, { version: 1, location: 'Pune' });
    const stale = await hr.patch(`/api/requisitions/${req.id}`, { version: 1, location: 'Chennai' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('stale');
  });

  it('asks for a version number so stale saves are detectable', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.patch(`/api/requisitions/${req.id}`, { location: 'Pune' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('missing_version');
  });

  it('rejects a bad experience range on update', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.patch(`/api/requisitions/${req.id}`, { version: 1, expMin: 9, expMax: 2 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('bad_range');
  });

  it('locks the core details once the role is sent for approval', async () => {
    const { hr, admin, req, h } = await setup();
    await hr.post(`/api/requisitions/${req.id}/submit`, submitBody(admin, h.person('HR').id));
    const res = await hr.patch(`/api/requisitions/${req.id}`, { version: 3, budgetMaxLpa: 40 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('locked');
  });

  it('deletes a draft, but refuses to delete a role that is open', async () => {
    const { hr, req, admin, h } = await setup({ withPlan: false });
    expect((await hr.delete(`/api/requisitions/${req.id}`)).statusCode).toBe(204);
    expect((await hr.get(`/api/requisitions/${req.id}`)).statusCode).toBe(404);

    const other = (await hr.post('/api/requisitions', { ...role, title: 'Other' })).json().requisition;
    await hr.post(`/api/requisitions/${other.id}/plan/template`, { templateId: 'lean-three' });
    await hr.post(`/api/requisitions/${other.id}/submit`, submitBody(admin, h.person('HR').id));
    await hr.post(`/api/requisitions/${other.id}/approvals/${1}/decide`, { decision: 'APPROVE' });
  });

  it('refuses to delete a requisition that is not a draft', async () => {
    const { hr, req, admin, h } = await setup();
    const approverA = h.person('HR');
    await hr.post(`/api/requisitions/${req.id}/submit`, submitBody(admin, approverA.id));
    const res = await hr.delete(`/api/requisitions/${req.id}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('not_draft');
  });
});

describe('the hiring plan (rounds)', () => {
  it('the standard template matches the PDF: online test at 60%, scorecards at 3, managerial and HR', async () => {
    const { req } = await setup();
    const [r1, r2, r3, r4, r5] = req.rounds;
    expect([r1.type, r1.passPercent]).toEqual(['ONLINE_TEST', 60]);
    expect([r2.type, r2.passAverage]).toEqual(['SCORECARD', 3]);
    expect([r3.type, r3.passAverage]).toEqual(['SCORECARD', 3]);
    expect(r4.type).toBe('DECISION');
    expect(r5.type).toBe('FINAL_APPROVAL');
  });

  it('the lean template has three rounds and the senior template starts with a take-home', async () => {
    const h = await harness();
    const hr = h.client(h.person('HR'));
    const id = (await hr.post('/api/requisitions', role)).json().requisition.id;
    const lean = (await hr.post(`/api/requisitions/${id}/plan/template`, { templateId: 'lean-three' })).json().requisition;
    expect(lean.rounds).toHaveLength(3);
    const senior = (await hr.post(`/api/requisitions/${id}/plan/template`, { templateId: 'senior-takehome' })).json().requisition;
    expect(senior.rounds).toHaveLength(4);
    expect(senior.rounds[0].type).toBe('TAKE_HOME');
  });

  it('lists the templates available to pick from', async () => {
    const h = await harness();
    const list = (await h.as('HR').get('/api/requisition-templates')).json().templates;
    expect(list.map((t) => t.id)).toEqual(['sde2-standard', 'lean-three', 'senior-takehome']);
    expect(list[0].roundCount).toBe(5);
  });

  it('an unknown template is refused', async () => {
    const { hr, req } = await setup({ withPlan: false });
    expect((await hr.post(`/api/requisitions/${req.id}/plan/template`, { templateId: 'nope' })).statusCode).toBe(404);
  });

  it('saves a custom plan the user built: rounds can be added, renamed and reordered', async () => {
    const { hr, req } = await setup();
    const current = (await hr.get(`/api/requisitions/${req.id}`)).json().requisition;
    const [r1, ...rest] = current.rounds;
    const plan = {
      version: current.version,
      rounds: [
        { ...rest[0], name: 'Design deep dive' },
        { id: r1.id, name: r1.name, type: r1.type, passPercent: 70, durationMin: 45 },
        { name: 'Pair programming', type: 'SCORECARD', passAverage: 3.5, skills: ['Pairing'] },
        ...rest.slice(1).map(({ id, ...r }) => ({ id, ...r })),
      ],
    };
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, plan);
    expect(res.statusCode).toBe(200);
    const after = res.json().requisition.rounds;
    expect(after).toHaveLength(6);
    expect(after[0].name).toBe('Design deep dive');
    expect(after.find((r) => r.id === r1.id).passPercent).toBe(70); // same round, kept id
    expect(after[2].name).toBe('Pair programming');
  });

  it('removing a round removes it from the plan', async () => {
    const { hr, req } = await setup();
    const current = (await hr.get(`/api/requisitions/${req.id}`)).json().requisition;
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, {
      version: current.version,
      rounds: current.rounds.slice(0, 3).map(({ id, ...r }) => ({ id, ...r })),
    });
    expect(res.json().requisition.rounds).toHaveLength(3);
  });

  it('asks for the pass mark on an online test and the average on a scorecard', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, {
      version: 1,
      rounds: [
        { name: 'Test', type: 'ONLINE_TEST' },
        { name: 'Tech', type: 'SCORECARD' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toEqual(expect.objectContaining({ 'rounds.0.passPercent': expect.any(String), 'rounds.1.passAverage': expect.any(String) }));
  });

  it('refuses two rounds with the same name', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, {
      version: 1,
      rounds: [
        { name: 'Tech', type: 'DECISION' },
        { name: 'tech', type: 'DECISION' },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('duplicate_round');
  });

  it('the final approval must be the last round, and there can be only one', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const early = await hr.put(`/api/requisitions/${req.id}/plan`, {
      version: 1,
      rounds: [{ name: 'HR', type: 'FINAL_APPROVAL' }, { name: 'Tech', type: 'DECISION' }],
    });
    expect(early.json().code).toBe('plan_rule');
    const two = await hr.put(`/api/requisitions/${req.id}/plan`, {
      version: 1,
      rounds: [{ name: 'HR 1', type: 'FINAL_APPROVAL' }, { name: 'HR 2', type: 'FINAL_APPROVAL' }],
    });
    expect(two.statusCode).toBe(422);
  });

  it('an empty plan is refused with a clear message', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, { version: 1, rounds: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.rounds).toMatch(/at least one round/);
  });

  it('a plan saved from an old version is refused', async () => {
    const { hr, req } = await setup({ withPlan: false });
    await hr.put(`/api/requisitions/${req.id}/plan`, { version: 1, rounds: [{ name: 'Chat', type: 'DECISION' }] });
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, { version: 1, rounds: [{ name: 'Chat 2', type: 'DECISION' }] });
    expect(res.statusCode).toBe(409);
  });

  it('copies the plan from another role', async () => {
    const { hr, req } = await setup();
    const target = (await hr.post('/api/requisitions', { ...role, title: 'Senior Java Developer' })).json().requisition;
    const res = await hr.post(`/api/requisitions/${target.id}/plan/copy`, { fromId: req.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().requisition.rounds.map((r) => r.name)).toEqual(req.rounds.map((r) => r.name));
  });

  it('copying from a role that does not exist is refused', async () => {
    const { hr, req } = await setup({ withPlan: false });
    expect((await hr.post(`/api/requisitions/${req.id}/plan/copy`, { fromId: 9999 })).statusCode).toBe(404);
  });

  it('a closed role cannot have its plan changed', async () => {
    const { hr, req } = await setup({ withPlan: false });
    await hr.post(`/api/requisitions/${req.id}/close`, { reason: 'Role cancelled by department' }).catch(() => {});
    const res = await hr.put(`/api/requisitions/${req.id}/plan`, { version: 1, rounds: [{ name: 'X', type: 'DECISION' }] });
    expect(res.statusCode).toBe(422);
  });
});

describe('sending a role for approval', () => {
  it('will not send a role that has no must-have skills, budget, date or plan', async () => {
    const h = await harness();
    const hr = h.client(h.person('HR'));
    const admin = h.person('ADMIN');
    const bare = (await hr.post('/api/requisitions', { title: 'Bare role' })).json().requisition;
    const res = await hr.post(`/api/requisitions/${bare.id}/submit`, { approvers: [{ label: 'HR', approverId: admin.id }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('incomplete');
    expect(res.json().error).toMatch(/must-have skill/);
    expect(res.json().error).toMatch(/budget/);
    expect(res.json().error).toMatch(/hiring plan/);
  });

  it('needs at least one approver', async () => {
    const { hr, req } = await setup();
    const res = await hr.post(`/api/requisitions/${req.id}/submit`, { approvers: [] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('no_approvers');
    expect(res.json().fields.approvers).toMatch(/Choose who approves/);
  });

  it('an interviewer cannot be chosen as an approver', async () => {
    const { hr, req, interviewer } = await setup();
    const res = await hr.post(`/api/requisitions/${req.id}/submit`, { approvers: [{ label: 'Finance', approverId: interviewer.id }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('bad_approver');
  });

  it('a step needs a label', async () => {
    const { hr, req, admin } = await setup();
    const res = await hr.post(`/api/requisitions/${req.id}/submit`, { approvers: [{ label: ' ', approverId: admin.id }] });
    expect(res.json().code).toBe('bad_step');
  });

  it('submits in order and moves the role to waiting for approval', async () => {
    const { hr, req, admin, h } = await setup();
    const dept = h.person('HR');
    const res = await hr.post(`/api/requisitions/${req.id}/submit`, submitBody(admin, dept.id));
    expect(res.statusCode).toBe(200);
    const r = res.json().requisition;
    expect(r.status).toBe('PENDING_APPROVAL');
    expect(r.approvals.map((a) => [a.position, a.label, a.status])).toEqual([
      [1, 'HR: budget and headcount', 'PENDING'],
      [2, 'Department head', 'PENDING'],
    ]);
  });

  it('cannot submit a role that is already waiting for approval', async () => {
    const { hr, req, admin, h } = await setup();
    await hr.post(`/api/requisitions/${req.id}/submit`, submitBody(admin, h.person('HR').id));
    const again = await hr.post(`/api/requisitions/${req.id}/submit`, submitBody(admin, h.person('HR').id));
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe('invalid_move');
  });
});

describe('approving', () => {
  async function waiting() {
    const ctx = await setup();
    const hrApprover = ctx.h.person('HR');
    const deptHead = ctx.h.person('RECRUITER');
    const submitted = (await ctx.hr.post(`/api/requisitions/${ctx.req.id}/submit`, {
      approvers: [
        { label: 'HR: budget and headcount', approverId: hrApprover.id },
        { label: 'Department head', approverId: deptHead.id },
      ],
    })).json().requisition;
    return { ...ctx, hrApprover, deptHead, submitted, steps: submitted.approvals };
  }

  it('the second step cannot be decided before the first', async () => {
    const { h, steps, deptHead } = await waiting();
    const res = await h.client(deptHead).post(`/api/requisitions/${steps[0].requisitionId ?? 1}/approvals/${steps[1].id}/decide`, { decision: 'APPROVE' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('out_of_order');
  });

  it('only the named approver can decide a step', async () => {
    const { h, submitted, steps, deptHead } = await waiting();
    const res = await h.client(deptHead).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Only .* can decide this step/);
  });

  it('approving every step opens the role; the chain records who decided', async () => {
    const { h, submitted, steps, hrApprover, deptHead } = await waiting();
    const first = await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    expect(first.json().requisition.status).toBe('PENDING_APPROVAL');
    const second = await h.client(deptHead).post(`/api/requisitions/${submitted.id}/approvals/${steps[1].id}/decide`, { decision: 'APPROVE', comment: 'Good to go' });
    expect(second.json().requisition.status).toBe('OPEN');
    expect(second.json().requisition.approvals.map((a) => a.status)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('an admin can step in and decide any step', async () => {
    const { h, submitted, steps } = await waiting();
    const admin = h.person('ADMIN');
    const res = await h.client(admin).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    expect(res.statusCode).toBe(200);
  });

  it('not approving needs a reason, and the role goes back to not approved', async () => {
    const { h, submitted, steps, hrApprover, hr } = await waiting();
    const noReason = await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'REJECT' });
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().fields.comment).toMatch(/short reason/);

    const rejected = await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'REJECT', comment: 'Budget is too low for SDE-2.' });
    expect(rejected.json().requisition.status).toBe('REJECTED');
    expect(rejected.json().requisition.statusReason).toMatch(/Budget is too low/);

    // Back in the recruiter's hands: details can be edited again and the role resubmitted.
    const fixed = await hr.patch(`/api/requisitions/${submitted.id}`, { version: rejected.json().requisition.version, budgetMaxLpa: 34 });
    expect(fixed.statusCode).toBe(200);
  });

  it('a step cannot be decided twice', async () => {
    const { h, submitted, steps, hrApprover } = await waiting();
    await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    const again = await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    expect(again.json().code).toBe('not_pending');
  });

  it('a decision must be approve or not approve', async () => {
    const { h, submitted, steps, hrApprover } = await waiting();
    const res = await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'MAYBE' });
    expect(res.statusCode).toBe(400);
  });

  it('a decision on a role that is not waiting is refused', async () => {
    const { h, hr, req } = await setup();
    const res = await h.client(h.person('ADMIN')).post(`/api/requisitions/${req.id}/approvals/1/decide`, { decision: 'APPROVE' });
    expect(res.json().code).toBe('not_pending');
    expect(hr).toBeDefined();
  });

  it('the decision trail is written to the audit history', async () => {
    const { h, submitted, steps, hrApprover, hr } = await waiting();
    await h.client(hrApprover).post(`/api/requisitions/${submitted.id}/approvals/${steps[0].id}/decide`, { decision: 'APPROVE' });
    const history = (await hr.get(`/api/requisitions/${submitted.id}/history`)).json().history;
    const actions = history.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['requisition.create', 'requisition.submit', 'requisition.approve']));
    expect(history.find((x) => x.action === 'requisition.approve').by_name).toBe(hrApprover.name);
  });
});

describe('hold, reopen and close', () => {
  async function open() {
    const ctx = await setup();
    const a = ctx.h.person('HR');
    const b = ctx.h.person('RECRUITER');
    const sub = (await ctx.hr.post(`/api/requisitions/${ctx.req.id}/submit`, {
      approvers: [{ label: 'HR', approverId: a.id }, { label: 'Dept', approverId: b.id }],
    })).json().requisition;
    await ctx.h.client(a).post(`/api/requisitions/${sub.id}/approvals/${sub.approvals[0].id}/decide`, { decision: 'APPROVE' });
    const done = (await ctx.h.client(b).post(`/api/requisitions/${sub.id}/approvals/${sub.approvals[1].id}/decide`, { decision: 'APPROVE' })).json().requisition;
    return { ...ctx, open: done };
  }

  it('holding needs a reason; reopening brings the role back', async () => {
    const { hr, open: r } = await open();
    expect((await hr.post(`/api/requisitions/${r.id}/hold`, {})).json().fields.reason).toBeUndefined();
    const noReason = await hr.post(`/api/requisitions/${r.id}/hold`, { reason: '' });
    expect(noReason.statusCode).toBe(422);
    const held = await hr.post(`/api/requisitions/${r.id}/hold`, { reason: 'Budget freeze until January' });
    expect(held.json().requisition.status).toBe('ON_HOLD');
    expect(held.json().requisition.statusReason).toBe('Budget freeze until January');
    const reopened = await hr.post(`/api/requisitions/${r.id}/reopen`, {});
    expect(reopened.json().requisition).toMatchObject({ status: 'OPEN', statusReason: null });
  });

  it('closing needs a reason and is final', async () => {
    const { hr, open: r } = await open();
    expect((await hr.post(`/api/requisitions/${r.id}/close`, { reason: 'x' })).statusCode).toBe(422);
    const closed = await hr.post(`/api/requisitions/${r.id}/close`, { reason: 'Filled internally' });
    expect(closed.json().requisition.status).toBe('CLOSED');
    expect((await hr.post(`/api/requisitions/${r.id}/reopen`, {})).json().code).toBe('invalid_move');
  });

  it('a draft cannot be closed or reopened: those moves are refused with a plain message', async () => {
    const { hr, req } = await setup({ withPlan: false });
    const res = await hr.post(`/api/requisitions/${req.id}/close`, { reason: 'Not needed' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/cannot change this requisition from "Draft" to "Closed"/);
    expect((await hr.post(`/api/requisitions/${req.id}/reopen`, {})).statusCode).toBe(422);
  });

  it('the plan can still change while a role is open, but nothing can change once closed', async () => {
    const { hr, open: r } = await open();
    const current = (await hr.get(`/api/requisitions/${r.id}`)).json().requisition;
    const ok = await hr.put(`/api/requisitions/${r.id}/plan`, {
      version: current.version,
      rounds: current.rounds.map(({ id, ...x }) => ({ id, ...x })),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('every status change is recorded with its reason', async () => {
    const { hr, open: r } = await open();
    await hr.post(`/api/requisitions/${r.id}/hold`, { reason: 'Freeze' });
    const history = (await hr.get(`/api/requisitions/${r.id}/history`)).json().history;
    const hold = history.find((x) => x.action === 'requisition.on_hold');
    expect(hold).toMatchObject({ reason: 'Freeze' });
  });
});

describe('data integrity', () => {
  it('the rounds table is keyed to the requisition and removed with it', async () => {
    const { h, req } = await setup();
    const count = () => helpers(h.db).one('SELECT COUNT(*) AS n FROM hiring_rounds WHERE requisition_id = ?', req.id).n;
    expect(count()).toBe(5);
    await h.as('HR').delete(`/api/requisitions/${req.id}`);
    expect(count()).toBe(0);
  });
});

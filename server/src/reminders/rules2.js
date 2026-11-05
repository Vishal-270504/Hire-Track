import { helpers } from '../db/index.js';
import { policy } from '../policy/index.js';
import { render } from '../templates/render.js';

/** Reminder rules for offers, joining, onboarding and probation. Same shape as rules.js. */
const H = 3600_000;
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const dayOf = (s) => new Date(`${s}T00:00:00Z`);

export const RULES2 = [
  {
    kind: 'offer_expiring', auto: true,
    run(db, now) {
      const out = [];
      for (const h of policy(db, 'offer.reminderHoursBefore')) {
        const rows = helpers(db).all(
          `SELECT o.id, o.expiry_date, c.id AS cid, c.name, r.title FROM offers o
             JOIN candidates c ON c.id = o.candidate_id JOIN requisitions r ON r.id = c.requisition_id
            WHERE o.status IN ('SENT','NEGOTIATING') AND o.expiry_date >= ? AND o.expiry_date <= ?`,
          day(now), day(addDays(now, h / 24)),
        );
        for (const r of rows) {
          out.push({
            dedupeKey: `offer:${r.id}:${h}`, title: `Offer reply due soon: ${r.name}`,
            body: render(policy(db, 'templates.offerReminder'), { name: r.name.split(' ')[0], role: r.title, expiry: r.expiry_date }),
            dueAt: new Date(dayOf(r.expiry_date).getTime() - h * H).toISOString(), candidateId: r.cid, role: 'HR',
          });
        }
      }
      return out;
    },
  },
  {
    kind: 'laptop_alert', auto: false,
    run(db, now) {
      const days = policy(db, 'joining.laptopAlertDaysBefore');
      return helpers(db).all(
        `SELECT id, name, join_date FROM candidates WHERE phase = 'PRE_JOINING' AND join_date IS NOT NULL AND join_date <= ?`,
        day(addDays(now, days)),
      ).map((c) => ({
        dedupeKey: `laptop:${c.id}`, title: `Laptop must be ready for ${c.name}`,
        body: `${c.name} joins on ${c.join_date}. If the laptop is not ready, issue a loaner and log it.`,
        dueAt: now.toISOString(), candidateId: c.id, role: 'IT',
      }));
    },
  },
  {
    kind: 'task_overdue', auto: true,
    run(db, now) {
      const today = day(now);
      return helpers(db).all(
        `SELECT t.id, t.title, t.owner_team, t.due_on, c.name, c.id AS cid FROM tasks t JOIN candidates c ON c.id = t.candidate_id
          WHERE t.status = 'OPEN' AND t.due_on < ?`,
        today,
      ).map((t) => ({
        dedupeKey: `task:${t.id}:${today}`, title: `Overdue: ${t.title}`,
        body: `For ${t.name}, due ${t.due_on}.`, dueAt: now.toISOString(), candidateId: t.cid, role: t.owner_team,
      }));
    },
  },
  {
    kind: 'checkin_due', auto: false,
    run(db, now) {
      const every = policy(db, 'joining.checkInEveryDays');
      const cutoff = day(addDays(now, -every));
      return helpers(db).all(
        `SELECT c.id, c.name, o.sign_at,
                (SELECT MAX(at) FROM checkins k WHERE k.candidate_id = c.id) AS last_checkin
           FROM candidates c JOIN offers o ON o.candidate_id = c.id AND o.status = 'ACCEPTED'
          WHERE c.phase = 'PRE_JOINING'`,
      ).filter((c) => (c.last_checkin ?? c.sign_at ?? '').slice(0, 10) <= cutoff).map((c) => ({
        dedupeKey: `checkin:${c.id}:${Math.floor(now.getTime() / (every * 86_400_000))}`,
        title: `Check in with ${c.name}`, body: 'Notice-period check-in: ask how things are and whether anything has changed.',
        dueAt: now.toISOString(), candidateId: c.id, role: 'HR',
      }));
    },
  },
  {
    kind: 'relieving_due', auto: false,
    run(db, now) {
      return helpers(db).all(
        `SELECT id, name, relieving_due FROM candidates WHERE relieving_status = 'LATER' AND relieving_due <= ?`,
        day(addDays(now, 7)),
      ).map((c) => ({
        dedupeKey: `relieving:${c.id}:${c.relieving_due}`, title: `Relieving letter due: ${c.name}`,
        body: `Collect the relieving letter by ${c.relieving_due}. Mark it received when it arrives.`,
        dueAt: now.toISOString(), candidateId: c.id, role: 'HR',
      }));
    },
  },
  {
    kind: 'review_due', auto: true,
    run(db, now) {
      return probationReviewGaps(db, now).filter((g) => !g.late && g.warn).map((g) => ({
        dedupeKey: `review:${g.empId}:${g.period}`, title: `${g.period === 'FINAL' ? 'Final' : `${g.period}-day`} review due: ${g.name}`,
        body: `Due ${g.due}. Ask the manager to complete it, with the buddy's and self-ratings.`, dueAt: g.due, candidateId: g.cid, role: 'HR',
      }));
    },
  },
  {
    kind: 'review_late', auto: true,
    run(db, now) {
      return probationReviewGaps(db, now).filter((g) => g.late).map((g) => ({
        dedupeKey: `reviewlate:${g.empId}:${g.period}`, title: `Review is late: ${g.name}`,
        body: `The ${g.period} review was due ${g.due} and has not been done. Escalated to HR.`, dueAt: g.due, candidateId: g.cid, role: 'HR',
      }));
    },
  },
  {
    kind: 'pip_checkin_due', auto: false,
    run(db, now) {
      const every = policy(db, 'probation.pipCheckInDays');
      const cutoff = day(addDays(now, -every));
      return helpers(db).all(
        `SELECT p.id, c.name, c.id AS cid, p.start_on,
                (SELECT MAX(at) FROM pip_checkins k WHERE k.pip_id = p.id) AS last_checkin
           FROM pips p JOIN employees e ON e.id = p.employee_id JOIN candidates c ON c.id = e.candidate_id
          WHERE p.status = 'ACTIVE'`,
      ).filter((p) => (p.last_checkin ?? p.start_on ?? '').slice(0, 10) <= cutoff).map((p) => ({
        dedupeKey: `pipci:${p.id}:${Math.floor(now.getTime() / (every * 86_400_000))}`,
        title: `Weekly improvement-plan check-in: ${p.name}`, body: 'Record what was discussed and how the goals are going.',
        dueAt: now.toISOString(), candidateId: p.cid, role: 'HR',
      }));
    },
  },
  {
    kind: 'survey_due', auto: false,
    run(db, now) {
      const out = [];
      for (const d of policy(db, 'probation.surveyDays')) {
        const rows = helpers(db).all(
          `SELECT e.id, e.name, e.joined_on, c.id AS cid FROM employees e JOIN candidates c ON c.id = e.candidate_id
            WHERE e.status != 'SEPARATED' AND e.joined_on <= ?
              AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s.employee_id = e.id AND s.day = ?)`,
          day(addDays(now, -d)), d,
        );
        for (const e of rows) {
          out.push({
            dedupeKey: `survey:${e.id}:${d}`, title: `Day ${d} survey due: ${e.name}`,
            body: 'Ask how onboarding is going, and record the rating and any comments.', dueAt: now.toISOString(), candidateId: e.cid, role: 'HR',
          });
        }
      }
      return out;
    },
  },
];

/** For each employee on probation: the next review, whether it is due soon, and whether it is late. */
function probationReviewGaps(db, now) {
  const today = day(now);
  const warn = policy(db, 'probation.reviewWarningDays');
  const out = [];
  for (const e of helpers(db).all("SELECT e.id, e.name, e.joined_on, e.probation_end, c.id AS cid FROM employees e JOIN candidates c ON c.id = e.candidate_id WHERE e.status = 'PROBATION'")) {
    const done = new Set(helpers(db).all('SELECT period FROM reviews WHERE employee_id = ?', e.id).map((r) => r.period));
    const next = policy(db, 'probation.reviewPeriods').find((p) => !done.has(p));
    if (!next) continue;
    const due = next === 'FINAL' ? e.probation_end : day(addDays(dayOf(e.joined_on), Number(next)));
    out.push({
      empId: e.id, name: e.name, cid: e.cid, period: next, due,
      late: due < today, warn: day(addDays(now, warn)) >= due,
    });
  }
  return out;
}

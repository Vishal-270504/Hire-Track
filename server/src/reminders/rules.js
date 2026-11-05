import { helpers } from '../db/index.js';
import { policy } from '../policy/index.js';
import { render, whenText } from '../templates/render.js';

const H = 3600_000;
const day = (d) => d.toISOString().slice(0, 10);

/**
 * Each rule looks at the data and returns the nudges that are due now.
 * A rule is { kind, auto, run(db, now) -> [{ dedupeKey, title, body, dueAt, candidateId, roundId, userId?, role? }] }.
 * "auto" rules are withdrawn automatically once their condition stops being true (e.g. feedback submitted).
 */
export const RULES = [
  {
    kind: 'interview_24h', auto: true,
    run(db, now) {
      return roundsStartingWithin(db, now, 24).map((r) => ({
        dedupeKey: `int24:${r.id}`, title: `Interview tomorrow: ${r.name} for ${r.candidate_name}`,
        body: render(policy(db, 'templates.interviewReminder'), {
          name: r.candidate_name.split(' ')[0], round: r.name, when: whenText(r.scheduled_at, r.time_zone), link: r.link,
        }),
        dueAt: new Date(new Date(r.scheduled_at) - 24 * H).toISOString(), candidateId: r.candidate_id, roundId: r.id,
        userIds: panelIds(db, r.id),
      }));
    },
  },
  {
    kind: 'interview_1h', auto: true,
    run(db, now) {
      return roundsStartingWithin(db, now, 1).map((r) => ({
        dedupeKey: `int1:${r.id}`, title: `Starts within the hour: ${r.name} for ${r.candidate_name}`,
        body: `${r.name} with ${r.candidate_name} at ${whenText(r.scheduled_at, r.time_zone)}. ${r.link ? `Join: ${r.link}` : ''}`.trim(),
        dueAt: new Date(new Date(r.scheduled_at) - 1 * H).toISOString(), candidateId: r.candidate_id, roundId: r.id,
        userIds: panelIds(db, r.id),
      }));
    },
  },
  {
    kind: 'feedback_due', auto: true,
    run(db, now) {
      const hours = policy(db, 'interviews.feedbackHours');
      return missingFeedback(db, now, hours).map((m) => ({
        dedupeKey: `fb:${m.round_id}:${m.user_id}`,
        title: `Feedback due: ${m.round_name} for ${m.candidate_name}`,
        body: render(policy(db, 'templates.feedbackNudge'), {
          interviewer: m.user_name.split(' ')[0], name: m.candidate_name.split(' ')[0], round: m.round_name,
        }),
        dueAt: new Date(new Date(m.scheduled_at).getTime() + hours * H).toISOString(),
        candidateId: m.candidate_id, roundId: m.round_id, userIds: [m.user_id],
      }));
    },
  },
  {
    kind: 'feedback_escalated', auto: true,
    run(db, now) {
      const hours = policy(db, 'interviews.feedbackEscalateHours');
      return missingFeedback(db, now, hours).reduce((acc, m) => {
        if (acc.some((x) => x.roundId === m.round_id)) return acc;
        acc.push({
          dedupeKey: `fbesc:${m.round_id}`,
          title: `Feedback is late: ${m.round_name} for ${m.candidate_name}`,
          body: `Feedback has been outstanding for more than ${hours} hours. Ask the panel to submit it, or reassign.`,
          dueAt: new Date(new Date(m.scheduled_at).getTime() + hours * H).toISOString(),
          candidateId: m.candidate_id, roundId: m.round_id, role: 'HR',
        });
        return acc;
      }, []);
    },
  },
  {
    kind: 'decision_needed', auto: true,
    run(db, now) {
      return helpers(db).all(
        `SELECT ir.id, ir.name, ir.candidate_id, c.name AS candidate_name, c.owner_id
           FROM interview_rounds ir JOIN candidates c ON c.id = ir.candidate_id
          WHERE ir.status = 'DECISION_NEEDED' AND c.stage != 'CLOSED'`,
      ).map((r) => ({
        dedupeKey: `dec:${r.id}`,
        title: `Decision needed: ${r.name} for ${r.candidate_name}`,
        body: 'The panel disagrees. Read the feedback and make the call.',
        dueAt: now.toISOString(), candidateId: r.candidate_id, roundId: r.id, role: 'HR',
      }));
    },
  },
  {
    kind: 'candidate_update_due', auto: true,
    run(db, now) {
      const hours = policy(db, 'interviews.candidateUpdateHours');
      const cutoff = new Date(now.getTime() - hours * H).toISOString();
      return helpers(db).all(
        `SELECT c.id, c.name, c.owner_id, c.status, r.title AS role FROM candidates c
           JOIN requisitions r ON r.id = c.requisition_id
          WHERE c.stage IN ('SCREENING','INTERVIEWS') AND c.updated_at < ? AND c.on_hold = 0`,
        cutoff,
      ).map((c) => ({
        dedupeKey: `upd:${c.id}:${day(now)}`,
        title: `Send an update to ${c.name}`,
        body: render(policy(db, 'templates.candidateUpdate'), {
          name: c.name.split(' ')[0], role: c.role, status: c.status, date: day(new Date(now.getTime() + 2 * 86_400_000)),
        }),
        dueAt: cutoff, candidateId: c.id, userIds: c.owner_id ? [c.owner_id] : [], role: c.owner_id ? null : 'RECRUITER',
      }));
    },
  },
  {
    kind: 'talent_pool_followup', auto: false,
    run(db, now) {
      return helpers(db).all(
        `SELECT id, name, follow_up_date FROM candidates
          WHERE status = 'Talent pool' AND follow_up_date <= ?`,
        day(now),
      ).map((c) => ({
        dedupeKey: `tp:${c.id}:${c.follow_up_date}`, title: `Talent pool follow-up: ${c.name}`,
        body: 'Check whether there is a role that fits them now.', dueAt: `${c.follow_up_date}T00:00:00.000Z`,
        candidateId: c.id, role: 'HR',
      }));
    },
  },
];

function panelIds(db, roundId) {
  return helpers(db).all('SELECT user_id FROM interview_panel WHERE interview_round_id = ? AND conflict = 0', roundId)
    .map((p) => p.user_id);
}

function roundsStartingWithin(db, now, hours) {
  const until = new Date(now.getTime() + hours * H).toISOString();
  return helpers(db).all(
    `SELECT ir.*, c.name AS candidate_name FROM interview_rounds ir JOIN candidates c ON c.id = ir.candidate_id
      WHERE ir.status = 'SCHEDULED' AND ir.scheduled_at > ? AND ir.scheduled_at <= ? AND c.stage != 'CLOSED'`,
    now.toISOString(), until,
  );
}

function missingFeedback(db, now, hours) {
  const cutoff = new Date(now.getTime() - hours * H).toISOString();
  return helpers(db).all(
    `SELECT ir.id AS round_id, ir.name AS round_name, ir.scheduled_at, ir.candidate_id,
            c.name AS candidate_name, p.user_id, u.name AS user_name
       FROM interview_rounds ir
       JOIN candidates c ON c.id = ir.candidate_id
       JOIN interview_panel p ON p.interview_round_id = ir.id
       JOIN users u ON u.id = p.user_id
      WHERE ir.status = 'SCHEDULED' AND ir.scheduled_at IS NOT NULL AND ir.scheduled_at <= ?
        AND p.submitted_at IS NULL AND p.conflict = 0 AND ir.type != 'ONLINE_TEST' AND c.stage != 'CLOSED'`,
    cutoff,
  );
}

/**
 * Who may do what. One table, so the rules are readable in one place and tested as a matrix.
 * Record-level rules (an interviewer seeing only their own candidates) are enforced in services.
 */
export const ROLES = ['HR', 'RECRUITER', 'INTERVIEWER', 'IT', 'ADMIN'];

const ALL = ROLES;
const STAFF = ['HR', 'RECRUITER', 'ADMIN'];

export const RULES = {
  'users.manage': ['ADMIN'],
  'settings.read': ALL,
  'settings.write': ['HR', 'ADMIN'],
  'requisition.read': STAFF,
  'requisition.write': STAFF,
  'requisition.approve': ALL,      // only the named approver for that step, checked in the service
  'candidate.read': [...STAFF, 'INTERVIEWER'], // interviewers: only candidates they are on the panel for
  'candidate.write': STAFF,
  'candidate.exit': STAFF,
  'round.schedule': STAFF,
  'feedback.submit': ALL,          // only panel members, checked in the service
  'salary.read': ['HR', 'ADMIN'],
  'reminders.read': ALL,           // each person sees their own reminders only
  'offer.manage': ['HR', 'ADMIN'], // offers carry salary: create, revise, extend, record the reply
  'offer.approve': ['HR', 'ADMIN'], // above-budget and backup offers
  'joining.view': STAFF,           // offers, check-ins, tasks, relieving letter
  'joining.manage': ['HR', 'ADMIN'], // documents, background checks, Day 1, join date
  'tasks.complete': ['HR', 'RECRUITER', 'IT', 'ADMIN'], // owner team checked in the service
  'onboarding.manage': ['HR', 'IT', 'ADMIN'], // onboarding items and assets
  'probation.read': ['HR', 'RECRUITER', 'ADMIN'],
  'probation.manage': ['HR', 'ADMIN'], // reviews, PIPs, confirm, extend, separate
  'reports.read': STAFF,
  'audit.read': ['ADMIN'],
  'candidate.anonymise': ['HR', 'ADMIN'],
};

export function can(role, action) {
  const allowed = RULES[action];
  if (!allowed) throw new Error(`Unknown permission: ${action}`);
  return allowed.includes(role);
}

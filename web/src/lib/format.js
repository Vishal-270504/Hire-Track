/** Plain-language formatting. Everything a person reads goes through here, so it stays consistent. */

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fmtDate(value) {
  if (!value) return '';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function fmtDateTime(iso, zone) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: zone || undefined,
  }).format(new Date(iso));
}

export function fmtAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(mins);
  if (abs < 60) return rtf.format(mins, 'minute');
  if (abs < 60 * 24) return rtf.format(Math.round(mins / 60), 'hour');
  return rtf.format(Math.round(mins / (60 * 24)), 'day');
}

export const lpa = (n) => (n == null || n === '' ? '—' : `${Number(n)} LPA`);
export const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`);

/** A score band the eye can read at a glance: good, check, or low. */
export function scoreTone(score) {
  if (score == null) return 'neutral';
  if (score >= 75) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

/** Tone for a candidate status, by its meaning. */
export function statusTone(status = '') {
  if (/Shortlisted|Selected|passed|Passed|Ready|In interviews|back in progress/i.test(status)) return 'ok';
  if (/Manual review|Parsing|Decision needed|Held|hold|to re-send|HR to decide|Check|review/i.test(status)) return 'warn';
  if (/Below cut-off|Rejected|Withdrawn|failed|not passed|Did not/i.test(status)) return 'bad';
  if (/Talent pool|Moved/i.test(status)) return 'info';
  return 'neutral';
}

export const STAGE_TEXT = { SCREENING: 'Screening', INTERVIEWS: 'Interviews', SELECTED: 'Selected', CLOSED: 'Closed' };
export const ROUND_TYPE_TEXT = {
  ONLINE_TEST: 'Online test (score %)',
  TAKE_HOME: 'Take-home (scored 1 to 5)',
  SCORECARD: 'Interview (scored 1 to 5)',
  DECISION: 'Hire or no hire',
  FINAL_APPROVAL: 'Final approval (HR)',
};
export const ROUND_STATUS_TEXT = {
  WAITING: 'Waiting for earlier rounds',
  TO_SCHEDULE: 'To schedule',
  SCHEDULED: 'Scheduled',
  NO_SHOW: 'No-show',
  PASSED: 'Passed',
  FAILED: 'Not passed',
  DECISION_NEEDED: 'Panel disagrees',
  HELD: 'On hold for review',
  PENDING_FINAL: 'Waiting for final approval',
  SUPERSEDED: 'Replaced',
  SELECTED: 'Selected',
};
export const ROUND_STATUS_TONE = {
  WAITING: 'neutral', TO_SCHEDULE: 'accent', SCHEDULED: 'info', NO_SHOW: 'warn', PASSED: 'ok', FAILED: 'bad',
  DECISION_NEEDED: 'warn', HELD: 'warn', PENDING_FINAL: 'accent', SUPERSEDED: 'neutral', SELECTED: 'ok',
};
export const REQ_STATUS_TEXT = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Waiting for approval', REJECTED: 'Not approved', OPEN: 'Open', ON_HOLD: 'On hold', CLOSED: 'Closed',
};
export const REQ_STATUS_TONE = {
  DRAFT: 'neutral', PENDING_APPROVAL: 'warn', REJECTED: 'bad', OPEN: 'ok', ON_HOLD: 'warn', CLOSED: 'neutral',
};
export const SOURCES = ['Careers page', 'LinkedIn', 'Naukri', 'Indeed', 'Employee referral', 'Recruitment agency', 'Campus drive', 'Other'];
export const REJECT_REASONS = [
  'Skills do not match the role',
  'Experience is too low',
  'Experience is too high for this level',
  'Salary expectation is above budget',
  'Notice period is too long',
  'Not available for the location or shift',
  'Did not attend the interview',
  'Other (explain below)',
];

import { z } from 'zod';

/**
 * Validation for each editable policy block. Rules the UI can show in plain words live here,
 * so HR cannot save a setting that breaks the process (for example weights that do not add to 100).
 */
const pct = z.number().min(0, 'Enter 0 or more.').max(100, 'Enter 100 or less.');
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const days = (min, max) => z.number().int().min(min).max(max);

export const BLOCK_SCHEMAS = {
  companyName: z.string().trim().min(2, 'Enter the company name.').max(80),
  ats: z.object({
    weights: z.object({
      mustHave: pct, experience: pct, goodToHave: pct, education: pct, stability: pct,
    }).refine((w) => sum(w) === 100, { message: 'The five weights must add up to exactly 100.' }),
    shortlistAt: days(1, 100),
    reviewAt: days(0, 100),
  }).refine((v) => v.reviewAt < v.shortlistAt, {
    message: 'Manual review must start below the shortlist mark.',
    path: ['reviewAt'],
  }),

  interviews: z.object({
    rescheduleLimit: days(0, 5),
    feedbackHours: days(1, 168),
    feedbackEscalateHours: days(1, 336),
    candidateUpdateHours: days(1, 336),
    reminderHoursBefore: z.array(days(0, 168)).max(4),
    noShowRebookOnce: z.boolean(),
    r1PassPercent: pct,
    roundPassAverage: z.number().min(1).max(5),
  }).refine((v) => v.feedbackEscalateHours >= v.feedbackHours, {
    message: 'Escalation must come after the feedback deadline.',
    path: ['feedbackEscalateHours'],
  }),

  offer: z.object({
    validityDays: days(1, 30),
    reminderHoursBefore: z.array(days(1, 336)).max(4),
    extensionDays: days(1, 30),
    maxExtensions: days(0, 3),
  }),

  notice: z.object({ maxDays: days(0, 365), buyoutAllowed: z.boolean() }),
  reapplyCoolingDays: days(0, 730),
  talentPoolFollowUpDays: days(30, 730),

  joining: z.object({
    laptopAlertDaysBefore: days(0, 30),
    relievingLetterDays: days(1, 180),
    checkInEveryDays: days(1, 60),
    maxDateChanges: days(0, 5),
  }),

  probation: z.object({
    months: days(1, 12),
    reviewWarningDays: days(0, 30),
    confirmAt: z.number().min(1).max(5),
    pipAt: z.number().min(1).max(5),
    criteria: z.array(z.object({
      name: z.string().trim().min(2, 'Name each criterion.'),
      weight: pct,
    })).min(1).max(10).refine((c) => c.reduce((a, b) => a + b.weight, 0) === 100, {
      message: 'The criteria weights must add up to exactly 100.',
    }),
  }).refine((v) => v.pipAt < v.confirmAt, {
    message: 'The improvement-plan mark must be below the confirmation mark.',
    path: ['pipAt'],
  }),

  checklists: z.object({
    documents: z.array(z.string().trim().min(2)).min(1, 'Keep at least one document.').max(40),
    access: z.array(z.string().trim().min(2)).min(1).max(40),
    offboarding: z.array(z.string().trim().min(2)).min(1).max(40),
  }),

  bgvChecks: z.array(z.string().trim().min(2)).min(1).max(12),
  dpdp: z.object({ retainAnonymisedReportsDays: days(30, 3650) }),
  templates: z.record(z.string(), z.string().trim().min(5, 'Write the message text.').max(1000)),
};

export const BLOCK_NAMES = Object.keys(BLOCK_SCHEMAS);

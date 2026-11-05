/**
 * Every editable number and list in the app, with the PDF's values as defaults.
 * HR can change any of these on the Settings screen; "Reset to plan default" restores these.
 */
export const DEFAULTS = {
  companyName: 'Your company',
  ats: {
    weights: { mustHave: 40, experience: 25, goodToHave: 15, education: 10, stability: 10 },
    shortlistAt: 75,
    reviewAt: 50,
  },
  interviews: {
    rescheduleLimit: 2,
    feedbackHours: 24,
    feedbackEscalateHours: 48,
    candidateUpdateHours: 48,
    reminderHoursBefore: [24, 1],
    noShowRebookOnce: true,
    r1PassPercent: 60,
    roundPassAverage: 3.0,
  },
  offer: {
    validityDays: 5,
    reminderHoursBefore: [48, 24],
    extensionDays: 3,
    maxExtensions: 1,
  },
  reapplyCoolingDays: 180,
  talentPoolFollowUpDays: 180,
  notice: { maxDays: 90, buyoutAllowed: true },
  joining: {
    laptopAlertDaysBefore: 5,
    relievingLetterDays: 30,
    checkInEveryDays: 14,
    maxDateChanges: 1,
  },
  probation: {
    months: 6,
    reviewPeriods: ['30', '60', '90', 'FINAL'],
    reviewWarningDays: 7,
    confirmAt: 3.0,
    pipAt: 2.5,
    pipMonths: [1, 3],
    pipCheckInDays: 7,
    criteria: [
      { name: 'Technical quality', weight: 30 },
      { name: 'Delivery', weight: 25 },
      { name: 'Learning and ownership', weight: 15 },
      { name: 'Collaboration and communication', weight: 15 },
      { name: 'Conduct and policy compliance', weight: 15 },
    ],
    surveyDays: [30, 90],
  },
  checklists: {
    documents: [
      'PAN card', 'Aadhaar card', 'Passport photo', 'Address proof (current and permanent)',
      '10th, 12th and degree marksheets', 'Offer and relieving letters', 'Last 3 months payslips',
      'Bank account / cancelled cheque', 'UAN (PF) number', 'Form 16 / previous tax details',
      'Signed offer letter, NDA and nominee details',
    ],
    access: [
      'Company email', 'SSO and MFA', 'VPN', 'GitHub', 'Jira', 'Confluence',
      'Slack / Teams', 'CI/CD', 'Dev and QA environments',
    ],
    offboarding: [
      'Revoke system access', 'Collect laptop and charger', 'Collect ID and access card',
      'Full and final settlement', 'Relieving or experience letter',
    ],
  },
  bgvChecks: ['Identity', 'Education', 'Past employment', 'Address', 'Criminal record', 'References'],
  dpdp: { retainAnonymisedReportsDays: 365 },
  // Prep tasks created when an offer is accepted. offsetDays is relative to the joining date.
  prepTasks: [
    { title: 'Create employee ID and HRMS profile', team: 'HR', offsetDays: -7 },
    { title: 'Create company email and add to team lists', team: 'IT', offsetDays: -5 },
    { title: 'Order and image laptop (IDE, JDK, Maven or Gradle, Docker, VPN, antivirus)', team: 'IT', offsetDays: -5 },
    { title: 'Order ID and access card, and allocate a seat (or ship the laptop)', team: 'ADMIN', offsetDays: -3 },
    { title: 'Request access: Git, Jira, Confluence, Slack or Teams, CI/CD, dev databases', team: 'IT', offsetDays: -2 },
    { title: 'Assign a buddy and confirm the reporting manager', team: 'HR', offsetDays: -3 },
    { title: 'Send the welcome email with the Day 1 agenda', team: 'HR', offsetDays: -2 },
  ],
  // Message text the app drafts for people. {placeholders} are filled in when the message is shown.
  templates: {
    interviewInvite: 'Hi {name}, your {round} for the {role} role is on {when} ({zone}). Join here: {link}',
    interviewReminder: 'Hi {name}, a reminder: your {round} is {when}. Join here: {link}',
    rescheduleLink: 'Hi {name}, we need to move your {round}. Pick a new slot here: {link}',
    rejection: 'Hi {name}, thank you for your time with us. We will not be moving ahead with your application for {role} this time. We will keep your profile for future roles.',
    offerReminder: 'Hi {name}, a quick reminder that your offer for {role} is waiting for your reply by {expiry}.',
    feedbackNudge: 'Hi {interviewer}, feedback for {name} ({round}) is due. Please add it within the next day.',
    candidateUpdate: 'Hi {name}, quick update on your {role} application: {status}. We will be in touch by {date}.',
    welcome: 'Welcome to {company}, {name}! Your first day is {when}. Please bring your original documents. {manager} will meet you, and your buddy is {buddy}.',
    offerLetter: 'Dear {name},\n\nWe are pleased to offer you the position of {role} at {company}.\n\nCTC: {ctc} LPA per year. Expected joining date: {joinDate}.\nThis offer is valid until {expiry}.\n\nPlease accept it by signing below.',
    confirmationLetter: 'Dear {name},\n\nBased on your performance during probation, we are pleased to confirm your employment as {role} at {company} with effect from {date}.\n\nEmployee code: {code}.',
    terminationLetter: 'Dear {name},\n\nYour employment as {role} at {company} ends on {date} under the probation clause in your appointment letter. Your full and final settlement will follow as per company policy.\n\nReason: {reason}.',
  },
};

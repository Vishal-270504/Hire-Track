import { helpers } from '../db/index.js';
import { policy } from '../policy/index.js';
import { createRequisition, applyTemplate, submitForApproval, decideApproval } from '../services/requisitions.js';
import { createCandidate, phoneScreen, startInterviews, getCandidate, rejectCandidate, talentPool, listCandidates } from '../services/candidates.js';
import { scheduleRound, submitFeedback, finalDecision } from '../services/interviews.js';
import { createOffer, approveOffer, acceptOffer, declineOffer, backOut } from '../services/offers.js';
import { listDocuments, storeDocumentFile, reviewDocument, listBgv, setBgv, joinCandidate } from '../services/joining.js';
import { setOnboardingItem, recordAsset, submitReview, approveReview, confirmEmployee } from '../services/employees.js';
import { createView } from '../services/tracker.js';
import { runReminders } from '../reminders/engine.js';

const DAY = 86_400_000;
const ymd = (d) => d.toISOString().slice(0, 10);
const at = (days, hour = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 5, 30, 0, 0); // 10:00 India time
  return d.toISOString();
};

/**
 * Demo data for a walk-through. Every record is created through the same services the app uses,
 * so timelines, audit rows, statuses and reminders are all real.
 * Run it once on an empty database: see server/README or docs/USER_GUIDE.md.
 */
export function seedDemoData(db, { now = new Date() } = {}) {
  const user = (email) => {
    const u = helpers(db).one('SELECT id, name, role FROM users WHERE email = ?', email);
    if (!u) throw new Error(`Demo user ${email} is missing. Run the base seed first.`);
    return u;
  };
  const hr = user('hr@hiretrack.local');
  const recruiter = user('recruiter@hiretrack.local');
  const interviewer = user('interviewer@hiretrack.local');
  const it = user('it@hiretrack.local');
  const admin = user('admin@hiretrack.local');
  const log = [];

  // ----- roles -----
  const javaRole = createRequisition(db, hr, {
    title: 'Java Developer', level: 'SDE-2', headcount: 5, team: 'Payments', location: 'Bengaluru', remote: false,
    budgetMaxLpa: 25, targetJoinDate: ymd(new Date(now.getTime() + 45 * DAY)),
    jdText: 'Build and run payment services in Java and Spring Boot. You will own features end to end, with code reviews and on-call support.',
    mustSkills: ['Core Java', 'Spring Boot', 'REST APIs', 'SQL', 'Git'], goodSkills: ['Kafka', 'Docker', 'JUnit'],
    expMin: 3, expMax: 5, noticeMaxDays: 60,
  }, now);
  applyTemplate(db, hr, javaRole.id, 'lean-three', now);
  const javaSub = submitForApproval(db, hr, javaRole.id, [{ label: 'HR: budget and headcount', approverId: hr.id }], now);
  decideApproval(db, hr, javaRole.id, javaSub.approvals[0].id, { decision: 'APPROVE' }, now);
  helpers(db).run('UPDATE requisitions SET published = 1 WHERE id = ?', javaRole.id);
  log.push('Role: Java Developer (open, published, 5 openings)');

  const seniorRole = createRequisition(db, hr, {
    title: 'Senior Backend Engineer', level: 'SDE-3', headcount: 1, team: 'Platform', location: 'Pune', remote: true,
    budgetMaxLpa: 40, targetJoinDate: ymd(new Date(now.getTime() + 90 * DAY)),
    mustSkills: ['Java', 'Microservices', 'Kafka', 'System design'], goodSkills: ['AWS'],
    expMin: 6, expMax: 10, noticeMaxDays: 90,
  }, now);
  applyTemplate(db, hr, seniorRole.id, 'senior-takehome', now);
  const seniorSub = submitForApproval(db, hr, seniorRole.id, [{ label: 'HR: budget and headcount', approverId: hr.id }, { label: 'Department head', approverId: admin.id }], now);
  void seniorSub; // waiting for the first approver: shows as "Waiting for approval"
  log.push('Role: Senior Backend Engineer (waiting for approval)');

  createRequisition(db, hr, {
    title: 'QA Engineer (Automation)', level: 'SDE-1', headcount: 1, team: 'Quality', location: 'Bengaluru',
    mustSkills: ['Selenium', 'Java'], goodSkills: ['Playwright'], expMin: 1, expMax: 3, noticeMaxDays: 30,
  }, now);
  log.push('Role: QA Engineer (draft)');

  // ----- candidates -----
  const resume = (extra = '') => `Software engineer. Core Java, Spring Boot, REST APIs, SQL, Git, Kafka, Docker. B.Tech computer science. ${extra} 2019 - 2021 Acme Systems. 2021 - present Beta Payments.`;
  const base = (name, phone, extra = {}) => ({
    requisitionId: javaRole.id, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
    phone, source: 'LinkedIn', location: 'Bengaluru', experienceYears: 4, expectedCtcLpa: 20, noticeDays: 30,
    workAuth: true, shiftOk: true, resumeText: resume(), ...extra,
  });
  const rounds = (id) => getCandidate(db, recruiter, id).rounds;
  const feedbackScores = (round, score = 4) => Object.fromEntries((round.skills.length ? round.skills : ['Overall']).map((s) => [s, score]));
  const pass = (c) => {
    const [tech, mgr, fin] = rounds(c.id);
    scheduleRound(db, recruiter, tech.id, { when: at(3), timeZone: 'Asia/Kolkata', panelIds: [interviewer.id], link: 'https://meet.example.com/tech-1' }, now);
    submitFeedback(db, interviewer, tech.id, { scores: feedbackScores(tech), comments: 'Strong Java fundamentals and clear reasoning on the coding task.' }, now);
    scheduleRound(db, recruiter, rounds(c.id)[1].id, { when: at(5), timeZone: 'Asia/Kolkata', panelIds: [interviewer.id], link: 'https://meet.example.com/mgr-1' }, now);
    submitFeedback(db, interviewer, rounds(c.id)[1].id, { recommendation: 'HIRE', comments: 'Owns problems end to end. Good communication.' }, now);
    finalDecision(db, hr, rounds(c.id)[2].id, { decision: 'APPROVE', comment: 'Good fit for the team.' }, now);
    void mgr; void fin;
  };
  const toOffer = (c, ctc = 22, backup = false) => {
    pass(c);
    createOffer(db, hr, c.id, { ctcLpa: ctc, joinDate: ymd(now), backup }, now);
    return helpers(db).one("SELECT * FROM offers WHERE candidate_id = ? ORDER BY version DESC LIMIT 1", c.id);
  };
  const toJoin = (c, offer) => {
    acceptOffer(db, hr, offer.id, { signName: c.name }, now);
    for (const doc of listDocuments(db, hr, c.id, now)) {
      storeDocumentFile(db, doc.id, { filename: `${doc.docType.slice(0, 12).replace(/\W+/g, '-')}.pdf`, mime: 'application/pdf', data: Buffer.from('%PDF-1.4 demo copy') }, now, hr);
      reviewDocument(db, hr, doc.id, { status: 'VERIFIED' }, now);
    }
    for (const b of listBgv(db, hr, c.id, now)) setBgv(db, hr, c.id, { checkType: b.checkType, status: 'CLEAR' }, now);
    joinCandidate(db, hr, c.id, {}, now);
    const emp = helpers(db).one('SELECT id FROM employees WHERE candidate_id = ?', c.id);
    const actors = { HR: hr, IT: it, ADMIN: admin };
    for (const item of helpers(db).all('SELECT item_key, owner_team FROM onboarding_items WHERE employee_id = ?', emp.id)) {
      setOnboardingItem(db, actors[item.owner_team], emp.id, { itemKey: item.item_key, done: true }, now);
    }
    recordAsset(db, it, emp.id, { assetType: 'LAPTOP', serial: `SN-${emp.id}${String(c.id).padStart(4, '0')}` }, now);
    return emp.id;
  };
  const review = (empId, period, score, approver) => {
    const scores = Object.fromEntries(policy(db, 'probation.criteria').map((k) => [k.name, score]));
    submitReview(db, hr, empId, { period, scores, leadComments: `Review at ${period} days.`, buddyComments: 'Helpful in code reviews.' }, now);
    if (approver) approveReview(db, approver, empId, period, now);
  };

  // 1. Fully confirmed employee
  const ravi = createCandidate(db, recruiter, base('Ravi Kumar', '9810000001'), now);
  phoneScreen(db, recruiter, ravi.id, { outcome: 'PASS', notes: 'Clear, keen, notice period fine.' }, now);
  startInterviews(db, recruiter, ravi.id, now);
  const raviEmp = toJoin(ravi, toOffer(ravi, 22));
  review(raviEmp, '30', 4);
  review(raviEmp, '60', 4);
  review(raviEmp, '90', 4);
  review(raviEmp, 'FINAL', 4, admin);
  confirmEmployee(db, hr, raviEmp, now);
  log.push('Employee: Ravi Kumar (confirmed)');

  // 2. On probation, 30-day review done, doing well
  const meera = createCandidate(db, recruiter, base('Meera Nair', '9810000002', { source: 'Employee referral' }), now);
  phoneScreen(db, recruiter, meera.id, { outcome: 'PASS', notes: 'Strong references.' }, now);
  startInterviews(db, recruiter, meera.id, now);
  const meeraEmp = toJoin(meera, toOffer(meera, 21));
  review(meeraEmp, '30', 4);
  log.push('Employee: Meera Nair (probation, 30-day review done)');

  // 3. On probation, first review was low: an improvement plan starts automatically
  const kabir = createCandidate(db, recruiter, base('Kabir Shah', '9810000003'), now);
  phoneScreen(db, recruiter, kabir.id, { outcome: 'PASS', notes: 'Good technical depth.' }, now);
  startInterviews(db, recruiter, kabir.id, now);
  const kabirEmp = toJoin(kabir, toOffer(kabir, 19));
  review(kabirEmp, '30', 2);
  log.push('Employee: Kabir Shah (improvement plan started automatically)');

  // 4. Offer sent, waiting for a reply
  const ananya = createCandidate(db, recruiter, base('Ananya Iyer', '9810000004'), now);
  phoneScreen(db, recruiter, ananya.id, { outcome: 'PASS', notes: 'Excellent communication.' }, now);
  startInterviews(db, recruiter, ananya.id, now);
  toOffer(ananya, 23);
  log.push('Offer: Ananya Iyer (sent, waiting for reply)');

  // 5. Offer accepted, joining in pre-joining with documents still to check
  const rohan = createCandidate(db, recruiter, base('Rohan Mehta', '9810000005'), now);
  phoneScreen(db, recruiter, rohan.id, { outcome: 'PASS', notes: 'Keen to join.' }, now);
  startInterviews(db, recruiter, rohan.id, now);
  acceptOffer(db, hr, toOffer(rohan, 21).id, { signName: rohan.name }, now);
  log.push('Pre-joining: Rohan Mehta (offer signed, documents to check)');

  // 6. Interview in progress: first round booked
  const priya = createCandidate(db, recruiter, base('Priya Sharma', '9810000006'), now);
  phoneScreen(db, recruiter, priya.id, { outcome: 'PASS', notes: 'Good call.' }, now);
  startInterviews(db, recruiter, priya.id, now);
  const priyaRound = rounds(priya.id)[0];
  scheduleRound(db, recruiter, priyaRound.id, { when: at(2, 15), timeZone: 'Asia/Kolkata', panelIds: [interviewer.id], link: 'https://meet.example.com/priya' }, now);
  log.push('Interview: Priya Sharma (technical round booked)');

  // 7. Panel disagreement waiting for HR
  const dev = createCandidate(db, recruiter, base('Dev Singh', '9810000007'), now);
  phoneScreen(db, recruiter, dev.id, { outcome: 'PASS', notes: 'Solid.' }, now);
  startInterviews(db, recruiter, dev.id, now);
  scheduleRound(db, recruiter, rounds(dev.id)[0].id, { when: at(1), timeZone: 'Asia/Kolkata', panelIds: [interviewer.id] }, now);
  log.push('Interview: Dev Singh (a round waiting for feedback)');

  // 8. Rejected after a phone screen (cooling-off applies for 6 months)
  const vikas = createCandidate(db, recruiter, base('Vikas Gupta', '9810000008', { experienceYears: 1 }), now);
  rejectCandidate(db, recruiter, vikas.id, 'Experience is too low for this level', now);
  log.push('Rejected: Vikas Gupta (cooling-off applies for 6 months)');

  // 9. Talent pool, follow up in three months
  const neha = createCandidate(db, recruiter, base('Neha Joshi', '9810000009', { experienceYears: 2 }), now);
  talentPool(db, recruiter, neha.id, { followUpDate: ymd(new Date(now.getTime() + 90 * DAY)), reason: 'Good profile for the next QA intake.' }, now);
  log.push('Talent pool: Neha Joshi (follow-up in 90 days)');

  // 10. Manual review: borderline resume, no decision yet
  createCandidate(db, recruiter, base('Arjun Verma', '9810000010', { resumeText: 'Java developer with 2 years on Spring Boot and SQL. B.Sc computer science.', experienceYears: 2 }), now);
  log.push('Manual review: Arjun Verma (borderline resume)');

  // 11. Backed out after accepting the offer
  const sana = createCandidate(db, recruiter, base('Sana Qureshi', '9810000011'), now);
  phoneScreen(db, recruiter, sana.id, { outcome: 'PASS', notes: 'Good fit.' }, now);
  startInterviews(db, recruiter, sana.id, now);
  acceptOffer(db, hr, toOffer(sana, 21, true).id, { signName: sana.name }, now); // backup offer, HR decided
  backOut(db, hr, sana.id, { reason: 'Accepted a counter-offer from the current employer' }, now);
  log.push('Backed out: Sana Qureshi (runner-ups suggested)');

  // A saved view for the team
  createView(db, hr, { name: 'Java shortlist', filters: { requisitionId: String(javaRole.id) }, shared: true }, now);

  // Reminders that the rules would send today
  runReminders(db, now);
  const count = helpers(db).one('SELECT COUNT(*) AS n FROM reminders').n;
  log.push(`Reminders generated: ${count}`);
  return { log, candidates: listCandidates(db, hr, {}).length };
}

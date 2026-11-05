/**
 * Resume scoring, out of 100, using the PDF's weights (read from policy, so HR can change them):
 *   must-have skills, relevant experience, good-to-have skills, education and certificates,
 *   and stability (tenure per job and unexplained gaps).
 * CTC and notice period are knock-out checks, not score: they produce flags, as the PDF describes.
 */

const ALIASES = {
  'core java': ['java', 'core java'],
  'spring boot': ['spring boot', 'springboot'],
  'rest apis': ['rest', 'restful', 'rest api'],
  rest: ['rest', 'restful'],
  sql: ['sql', 'mysql', 'postgresql', 'postgres', 'oracle', 'sql server'],
  git: ['git', 'github', 'gitlab', 'bitbucket'],
  microservices: ['microservice', 'microservices'],
  hibernate: ['hibernate', 'jpa'],
  kubernetes: ['kubernetes', 'k8s'],
  aws: ['aws', 'amazon web services'],
  junit: ['junit', 'mockito'],
  'ci/cd': ['ci/cd', 'jenkins', 'github actions', 'gitlab ci'],
};

const YEARS = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years|yrs|year)/i;
const EDUCATION = /b\.?\s?tech|\bb\.?e\b|\bmca\b|m\.?\s?tech|b\.?sc|m\.?sc|\bbca\b|computer science|engineering/i;
const CERTS = /oracle certified|\bocp\b|aws certified|spring (certified|professional)|certification/i;
// e.g. "Jan 2019 - Mar 2021", "2018 – present", "2017 to 2019"
const RANGE = /((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)/gi;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function hasSkill(text, skill) {
  const key = skill.trim().toLowerCase();
  const terms = ALIASES[key] ?? [key];
  return terms.some((term) => new RegExp(`(^|[^a-z0-9])${escape(term)}([^a-z0-9]|$)`).test(text));
}

/** Job-date ranges found in the resume, as [startYear, endYear] pairs, newest first as written. */
export function jobRanges(text, nowYear = new Date().getFullYear()) {
  return [...text.matchAll(RANGE)].map((m) => {
    const end = /^\d/.test(m[2]) ? Number(m[2]) : nowYear;
    return [Number(m[1]), end];
  }).filter(([s, e]) => e >= s);
}

export function stabilityPoints(ranges, weight) {
  if (ranges.length === 0) return { points: Math.round(weight * 0.5), note: 'Job dates were not found, so half marks are given.' };
  const spans = ranges.map(([s, e]) => e - s);
  const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] - sorted[i - 1][1] > 1) gaps += 1;
  let fraction = avg >= 1.5 ? 1 : avg >= 1 ? 0.7 : 0.4;
  if (gaps > 0) fraction *= 0.5;
  return {
    points: Math.round(weight * fraction),
    note: gaps > 0 ? `${gaps} gap(s) of more than a year between jobs. Ask about them.` : null,
  };
}

/**
 * @param {object} input  resume + job facts
 * @param {object} policyWeights  { mustHave, experience, goodToHave, education, stability }
 * @returns {{score, breakdown, matched, missing, flags}}
 */
export function scoreResume({ resumeText = '', mustSkills = [], goodSkills = [], experienceYears, expMin, expMax }, policyWeights) {
  const t = resumeText.toLowerCase();
  const w = policyWeights;
  const flags = [];

  const mustHit = mustSkills.filter((s) => hasSkill(t, s));
  const goodHit = goodSkills.filter((s) => hasSkill(t, s));
  const mustPts = mustSkills.length ? Math.round((w.mustHave * mustHit.length) / mustSkills.length) : w.mustHave;
  const goodPts = goodSkills.length ? Math.round((w.goodToHave * goodHit.length) / goodSkills.length) : w.goodToHave;

  let exp = experienceYears ?? 0;
  if (!exp) {
    const m = YEARS.exec(t);
    if (m) exp = Number(m[1]);
  }
  const lo = expMin ?? 0;
  const hi = expMax ?? 99;
  const expFraction = exp >= lo && exp <= hi ? 1 : exp >= lo - 1 && exp <= hi + 1 ? 0.6 : 0.2;
  const expPts = Math.round(w.experience * expFraction);

  let eduFraction = 0;
  if (EDUCATION.test(t)) eduFraction += 0.6;
  if (CERTS.test(t)) eduFraction += 0.4;
  const eduPts = Math.round(w.education * Math.min(1, eduFraction));

  const stab = stabilityPoints(jobRanges(t), w.stability);
  if (stab.note) flags.push(stab.note);

  const missing = mustSkills.filter((s) => !mustHit.includes(s));
  if (missing.length) flags.push(`Missing must-have skills: ${missing.join(', ')}`);

  const score = mustPts + goodPts + expPts + eduPts + stab.points;
  return {
    score,
    breakdown: {
      mustHave: mustPts, goodToHave: goodPts, experience: expPts, education: eduPts, stability: stab.points,
    },
    matched: [...mustHit, ...goodHit],
    missing,
    flags,
  };
}

/** Screening outcome from the score and the policy cut-offs. */
export function screeningStatus(resumeText, score, { shortlistAt, reviewAt }) {
  if ((resumeText ?? '').trim().length < 40) return 'Parsing failed';
  if (score >= shortlistAt) return 'Shortlisted';
  if (score >= reviewAt) return 'Manual review';
  return 'Below cut-off';
}

/** Knock-out checks from the PDF (CTC, notice, location, work authorisation, shift). Returns flags to show. */
export function knockoutFlags({ expectedCtc, budgetMaxLpa, noticeDays, noticeMaxDays, workAuth, shiftOk, location, reqLocation, remote }) {
  const flags = [];
  if (expectedCtc != null && budgetMaxLpa != null && expectedCtc > budgetMaxLpa) flags.push('Expected salary is above the budget');
  if (noticeDays != null && noticeMaxDays != null && noticeDays > noticeMaxDays) {
    flags.push(`Notice period is longer than ${noticeMaxDays} days. Needs manager approval to continue`);
  }
  if (workAuth === false) flags.push('Work authorisation is not confirmed');
  if (shiftOk === false) flags.push('Shift availability does not fit the role');
  if (!remote && location && reqLocation && location.toLowerCase() !== reqLocation.toLowerCase()) {
    flags.push(`Lives in ${location}. Check relocation fit`);
  }
  return flags;
}

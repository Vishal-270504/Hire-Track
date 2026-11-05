# HireTrack

Hiring, onboarding and probation tracker for a Java developer role, built from the plan "Java Developer Hiring: Pre-Onboarding to Post-Onboarding Process". It takes a role from approval through the candidate pipeline, offer, joining, onboarding and probation to confirmation or separation, with reminders at every step.

## Run it

You need Node.js 22 or newer. Nothing else: no Docker, no Java, no database server.

```bash
npm install
npm run dev
```

- Open **http://localhost:5173** (the app)
- The API runs on **http://localhost:3001**

On the first start the database is created in `server/hiretrack.db` with demo accounts. Delete that file to start again.

### Demo accounts

On the sign-in page, click a role to fill it in. The password for every demo account is `hiretrack-demo`.

| Person | Role | What they can do |
| --- | --- | --- |
| Priya Raman | HR | Run hiring end to end: approve roles, make offers, check documents and background checks, join, probation decisions |
| Arjun Mehta | Recruiter | Add candidates, screen, schedule interviews, manage the pipeline |
| Sana Iqbal | Interviewer | See only candidates on her panel, and give feedback |
| Dev Kaur | IT | Complete IT tasks and onboarding items (laptop, email, access) |
| Rohan Shah | Admin | Everything, plus team management, settings, audit export, and the HR head's approval of separations |

## A walk-through to try (about ten minutes)

1. **Sign in as Priya.** Open **Roles**, create a role (or open one), choose a hiring plan, send it for approval, approve it, then **Publish to careers page**.
2. **Open the careers page** at `/careers`. No sign-in is needed. Apply as a candidate. The reply gives a private status link.
3. **Back as Arjun** (or Priya): open the candidate from **Candidates** or **Board**. Hold the phone screen, start interviews, and schedule the first round with Sana on the panel.
4. **As Sana:** open the candidate (she sees only her own candidates) and add feedback. Rounds pass or fail by the plan's rules.
5. **Final approval** (HR) on the last round. On the **Offer** tab, make an offer. Above budget it waits for approval. The candidate signs on their status page, or you record it.
6. **Joining** tab: check the documents, set background checks to clear, change the joining date once, tick prep tasks as IT, then **Day 1: join**.
7. **Onboarding and probation** tab: tick the onboarding items (IT and admin own some) and record the laptop serial. When all access is live, probation starts. Record the 30, 60, 90 and final reviews, approve the final one as someone other than the writer, then **Confirm**.
8. **Today**, **Board**, **Probation** and **Reports** show what needs attention and where everyone is. **Candidates** has saved views and an Excel export.

## What is built

| Area | What works |
| --- | --- |
| **Sign-in and team** | Email and password, sessions that end after 12 hours, change password, five roles, admin team management, and an audit trail of every change |
| **Roles** | Budget, headcount, skills, experience and notice limit; approval chain in order; hiring plan with templates (the standard five rounds from the PDF, a lean three, and a senior plan with a take-home); copy rounds from another role; hold, reopen, close; publish to the careers page |
| **Screening** | Add by hand, or from a PDF, Word or text resume; score out of 100 with the PDF's weights; duplicate check by email, phone and PAN; cooling-off after a rejection; knock-out questions; HR phone screen; talent pool; reject with a 10-minute undo and a draft email |
| **Interviews** | Rounds from the plan; scheduling in time zones, with calendar invites; reschedule limit; no-shows; feedback per panel member; pass rules; panel disagreement goes to HR; conflicts; integrity hold; test re-issue; final approval |
| **Offers** | Above-budget and backup approval; headcount limit; typed-name signature; negotiate, decline (with runner-ups), extend once, revise (versions kept), expire, revoke, back out |
| **Joining** | 11-document checklist with file upload and checks (affidavit, to follow, needs replacing); background checks by type; prep tasks by team, with due dates that move with the joining date; check-ins; Day 1 join with employee code and company email; Day 1 no-show |
| **Onboarding** | Day 1 and access checklists by owner team; assets (laptop serial, loaners); probation starts when all access is live |
| **Probation** | 30, 60, 90 and final reviews with weighted score and outcome; approval by someone other than the writer; improvement plans with weekly check-ins; confirm; extend once; separate with fairness checks and HR head approval; offboarding tasks; surveys at day 30 and 90; confirmation and termination letters |
| **Reminders** | Today's worklist, the bell, and a digest. Interview times, feedback due and late, decisions needed, candidate updates every 48 hours, offer replies, laptop alerts, overdue tasks, check-ins, relieving letters, reviews due and late, plan check-ins, surveys, talent-pool follow-ups and @mentions. Each has copy-ready text |
| **Board and tracker** | Kanban by stage, with "Move to" menus that only offer real moves; saved and shared views; ready-made views (my actions, feedback overdue, interviews this week, offers awaiting reply, joining this month, documents pending, stuck, talent pool); bulk reject and assign; Excel export |
| **Reports** | Key numbers (days to hire, offer acceptance, probation pass rate, leaving within 90 days, days to final review), each with its definition; funnel; dropouts; audit log export (admin) |
| **Privacy** | Salary is visible only to HR and admin; documents only to HR; interviewers see only their own candidates; a closed candidate can be anonymised while the reports keep their numbers |
| **Careers and candidate page** | Public role list (no budget shown); apply with consent; a private status page with the candidate's documents to upload and their offer to accept, negotiate or decline |
| **Settings** | Every number and message from the plan, with its value, validation (weights total 100) and reset; message text for invitations, reminders, letters and the company name |

## Demo data

To fill the app with realistic example data (roles, candidates at every stage, an employee on probation, an employee already confirmed, offers, reminders and a saved view):

```bash
npm run seed:demo
```

- It only adds data to an empty database. If candidates already exist, it adds nothing.
- To start completely clean, stop the app (`Ctrl+C`), then run `npm run seed:demo -- --reset`, and start the app again.
- The data is created through the same services the app uses, so the timelines, audit trail and reminders are real.
- Sign in as `hr@hiretrack.local` with password `hiretrack-demo` to see everything.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `DB_FILE` | `hiretrack.db` | SQLite file location |
| `NODE_ENV` | (unset) | `production` turns off demo accounts and the demo sign-in buttons |
| `SESSION_SECRET` | development value | Set this outside development |
| `COMPANY_DOMAIN` | `company.com` | Domain for generated company emails |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | unset | Create the first admin when the database is empty |

## Documentation

- **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**: a plain-language guide to every screen and tab, and the steps for each task. Start here if you use the app.
- **[docs/CODE_GUIDE.md](docs/CODE_GUIDE.md)**: the tech stack, how a request moves through the code, what each module owns, where each rule lives, and how to add a feature.
- **[docs/API.md](docs/API.md)**: every endpoint, with who can call it.

## Project layout

```
server/   Node + Fastify API, SQLite, business rules in services/, reminders, policy
web/      React + Vite (JavaScript), screens in features/, shared kit in components/
docs/     code guide and API reference
```

## Status and limits

- The full hiring lifecycle runs end to end through the API. Every screen was opened in a real browser to check for errors.
- The automated tests from the earlier milestones have not yet been brought up to date for the new features, so `npm test` will report failures until they are. That is the next step when you want them.
- Not built: sending real email or calendar invites (drafts are copied by hand), sign-in through Google or Microsoft, OCR for scanned resumes, file storage outside the database, and links to a background-check vendor or an e-signature service.
- Files are kept inside the SQLite database (up to 5 MB each). Moving them to object storage is a later step.

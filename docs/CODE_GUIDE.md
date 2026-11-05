# HireTrack code guide

This guide explains what is in the code, how a request moves through it, and where each rule from the hiring plan lives. Read this first, then `API.md` for the list of endpoints.

## 1. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js 22+ (tested on 25) | One language front and back, no build step on the server |
| API | Fastify 5 | Fast, small, validation hooks, `app.inject()` for in-memory calls |
| Validation | Zod 3 | One schema per request, readable errors with field names |
| Database | SQLite through Node's built-in `node:sqlite` | Zero install; one file; migrations in code |
| Sessions | Random token in an httpOnly cookie; only its SHA-256 hash is stored | No external identity service needed for the MVP |
| Passwords | scrypt (Node `crypto`) | Built in, salted |
| Uploads | `@fastify/multipart` (5 MB limit) | Resumes and documents |
| Resume text | `unpdf` (PDF), `mammoth` (Word), plain read (text) | Pure JavaScript, no native tools |
| Spreadsheet export | `xlsx` | Writes the candidates Excel file |
| Web UI | React 18, Vite 6, React Router 6 | Standard, fast dev server, plain JavaScript |
| Server state | TanStack Query 5 | Caching, refetching, and loading/error states in one place |
| Forms | react-hook-form + Zod on the client (where used) and server field errors | Errors land next to the field |
| Accessible primitives | Radix Tabs and Dropdown Menu | Keyboard and screen-reader behaviour done properly |
| Toasts | Sonner | Undo actions on rejections |
| Icons | Lucide | One icon set, one stroke weight |
| Font | Public Sans (self-hosted via `@fontsource-variable`) | No external font requests |
| Tests | Vitest, Testing Library (written earlier, not yet updated; see section 10) | |

There is no Docker, Java, Maven, or database server.

## 2. Repository layout

```
hiretrack-app/
  package.json            npm workspaces; scripts: dev, test, seed
  README.md               how to run, what is built, demo walkthrough
  docs/
    CODE_GUIDE.md         this file
    API.md                every endpoint, generated from the route files
  server/
    src/
      server.js           starts the HTTP server and the reminder timer
      app.js              builds the Fastify app: plugins, error handler, route registration
      clock.js            the only place "now" comes from (tests can move time)
      errors.js           AppError and helpers: rule(), notFound(), forbidden(), stale()
      db/                 SQLite connection, migrations, repositories (raw SQL, one file per area)
      auth/               sessions, passwords, permissions, request guard
      audit/              writes and reads the audit trail
      policy/             every editable number and message, with PDF defaults and validation
      workflow/           lifecycle rules: which status or stage may move to which
      services/           business logic, one file per area (the heart of the system)
      routes/             thin HTTP layer: parse input, check permission, call a service
      reminders/          rules that create nudges, the engine that runs them, the store
      ats/                resume scoring and resume text extraction
      templates/          {placeholder} filling for messages and letters
      seed/               demo accounts for development
  web/
    index.html            page shell and favicon
    src/
      main.jsx            React root, query client, router, global CSS
      App.jsx             every route, with public pages outside sign-in
      components/         shell and shared UI kit (ui.jsx, kit.jsx), dialogs used everywhere
      features/           one folder per screen area (candidates, requisitions, board, ...)
      lib/                API client, auth hook, data hooks, formatting, forms helper
      styles/             design tokens, base, components, and one file per area
```

## 3. How a request travels (server)

Take `POST /api/offers/:id/accept` as the example.

1. **Fastify** matches the route. The route file (`routes/offers.js`) receives `req`.
2. **Cookie and user** — `auth/guard.js` attached `req.user` in an `onRequest` hook by reading the `ht_session` cookie and looking up the session (`auth/session.js`). Expired sessions and deactivated users give `null`.
3. **Permission** — the route calls `needCan(req, 'offer.manage')`. That checks `req.user` exists (401 if not) and that the role is in the table in `auth/permissions.js` (403 if not). The same table drives the menus in the web app, through `permissions` returned by `/api/auth/me`.
4. **Input** — the route parses the body with a Zod schema (or the service does). A bad value throws a `ZodError`, which the error handler turns into a 400 with per-field messages.
5. **Service** — the route calls one service function (`services/offers.js → acceptOffer`). The service:
   - loads the records it needs through the repositories (`db/repo/*`) and `requireCandidate` (which also applies the record-level visibility rule),
   - checks business rules (for example, the offer must still be open and not expired),
   - writes inside a transaction (`helpers(db).tx`),
   - writes a timeline event (`addEvent`) and an audit row (`audit`) for every change.
6. **Errors** — any `AppError` (created by `rule()`, `notFound()`, `forbidden()`, `stale()`) goes out as `{ error, code, fields }`. `error` is written for people; `code` is for the UI to choose a next step. Unexpected errors are logged on the server and shown to the user as a plain message.
7. **Response** — the service returns the fresh candidate view (`getCandidate`), which the route sends back. Fields that only certain roles may see (salary) are removed there, not in the UI.

Public routes (`routes/public.js`) follow the same path, but use a fixed system actor with no salary or document access, and a per-address rate limit.

## 4. The main modules, and what each one owns

### 4.1 Lifecycle and workflow (`workflow/`)

- `workflow/requisitions.js` — the role lifecycle: Draft → Waiting for approval → Open → On hold → Closed, with "Not approved" able to go back to Draft. `moveTo()` is the only way to change status, so an illegal jump is refused in one place.
- `workflow/candidates.js` — the pipeline stages: Screening → Interviews → Selected → Closed. Inside "Selected", a `phase` field says where the person is: `OFFER`, `PRE_JOINING`, `ONBOARDING`, `PROBATION`, `CONFIRMED`, `SEPARATED`. The board is built from these two fields.

### 4.2 Requisitions (`services/requisitions.js`, `db/repo/requisitions.js`)

- Create, edit (core details locked once the role leaves Draft or Not approved), delete a draft.
- **Hiring plan** (`savePlan`): rounds are saved in one go. Rounds keep their id when edited, so interview records stay attached. A round that a candidate has reached cannot be deleted.
- **Templates** (`policy/templates.js`): the standard five-round plan from the PDF, a lean three-round plan, and a senior plan that starts with a take-home.
- **Approvals** (`submitForApproval`, `decideApproval`): the chosen approvers act in order; only the named approver (or an admin) may decide; a rejection needs a reason and returns the role to "Not approved".
- Hold and close cascade to candidates: holding a role puts its candidates on hold; reopening releases only those holds.

### 4.3 Candidates and screening (`services/candidates.js`, `ats/`)

- **Intake** (`createCandidate`): validates, checks for duplicates (email, phone, PAN), applies the cooling-off period after a rejection, scores the resume, sets the first status, and adds a token for the candidate's private page. Below the cut-off, the candidate is rejected automatically with the 10-minute undo window.
- **Scoring** (`ats/scoring.js`): five criteria with the policy weights — must-have skills, experience fit, good-to-have skills, education and certificates, and stability (job gaps and tenure, read from date ranges in the resume). Knock-outs (salary, notice, work permit, shift, location) are flags, not score, as the PDF describes.
- **Screening steps**: knock-out answers (`saveKnockouts`), long notice approval, HR phone screen (`phoneScreen`), start the interview rounds (`startInterviews`).
- **Decisions**: reject (`rejectCandidate`, with undo for 10 minutes and a draft email), undo (`undoReject`), withdraw, talent pool (with a follow-up date), hold and resume, move to another role (`moveJob` keeps feedback), change owner, notes with @mentions.
- **Visibility** (`canSee`): interviewers only see candidates they are on a panel for; the rest get "not found" rather than "forbidden" so the existence of a record is not revealed.
- **Salary**: current and expected salary are only returned to HR and admins. Others get `ctcWithinBudget`.

### 4.4 Interviews (`services/interviews.js`, `db/repo/interviews.js`)

- A candidate's rounds are copies of the role's rounds (`interview_rounds`), each with a status: Waiting, To schedule, Scheduled, No-show, Passed, Not passed, Panel disagrees, On hold for review, Waiting for final approval, Replaced.
- **Scheduling** (`scheduleRound`): time must be in the future; panel members must be active interviewers and free within an hour; the reschedule limit is enforced (default 2, then HR approval).
- **Feedback** (`submitFeedback`): each panel member gives scores (1 to 5 per skill) or a hire/no-hire view, with comments. For online tests, staff enter the percentage.
- **Verdict** (`evaluate`): when every panel member has submitted, the round passes, fails, or is marked as disagreeing (which goes to HR). The pass rules come from the round's type and the plan.
- **HR decisions**: resolve a disagreement or a failed round (`resolveDecision`), review an integrity hold (`resolveHold`), re-issue a test once (`reissueTest`), final approval after the last round (`finalDecision`, which sets the candidate to Selected with phase Offer).
- No-shows: one rebook; a second needs HR to confirm the rejection.
- Conflicts of interest and panel changes (`declareInterviewConflict`, `replacePanel`); free-panel suggestions (`suggestPanel`); calendar invites (`inviteIcs`).

### 4.5 Offers (`services/offers.js`)

- `createOffer`: needs the Selected/Offer phase; headcount limits offers per role unless HR marks one as backup; above budget goes to `PENDING_APPROVAL` until HR or an admin approves.
- `reviseOffer` keeps the old version as `SUPERSEDED`. `acceptOffer` records the typed name as the e-signature, sets phase Pre-joining, and creates the prep tasks.
- `negotiateOffer`, `declineOffer` (returns runner-up candidates), `extendOffer` (up to the policy limit), `expireOffers` (run by the reminder engine), `revokeOffer` (after a background-check finding), `backOut` (after accepting; cancels the joining tasks).

### 4.6 Joining (`services/joining.js`)

- **Documents**: the 11-item checklist from policy. Each is Not received, Received (to check), Checked, Needs replacing (with a reason), Affidavit or gazette notice (with a note), or To follow (with a note). Files are stored in SQLite (`document_files`) up to 5 MB. Only HR and admins see documents.
- **Background checks**: one row per check type from policy (identity, education, employment, address, criminal record, references). Any flag puts the candidate on hold for the HR head.
- **Prep tasks**: created when the offer is accepted, from the `prepTasks` policy list, with due dates counted from the joining date. Changing the joining date (once) moves them.
- **Join** (`joinCandidate`, Day 1): refuses unless the offer is signed, documents are complete, and background checks are clear (or the candidate joins subject to checks, which restricts access). Creates the employee record, the employee code (EMP-1001 onward), and a company email (`first.last@COMPANY_DOMAIN`, de-duplicated), plus the Day 1 and access checklists.
- **Day 1 no-show**: closes the candidate, cancels the joining tasks.

### 4.7 Onboarding and probation (`services/employees.js`)

- **Onboarding**: checklist items are owned by a team (HR, IT, Admin); the owner (or admin) ticks them. When every access item is live, probation starts automatically with the end date from policy.
- **Assets**: laptop serials, loaner laptops, ID and access cards; returns are recorded.
- **Reviews** (`submitReview`): the periods come from policy (30, 60, 90, final), in order. The weighted score is the sum of weight × score ÷ 100, using the policy criteria (the PDF example gives 3.75). Outcome: 4.0+ exceeds, 3.0+ meets, 2.5+ needs improvement, below that not meeting. An early review below the improvement mark starts a plan automatically.
- **Approval**: a review must be approved by someone other than the person who wrote it (`approveReview`).
- **Improvement plans** (`startPip`, `pipCheckin`, `closePip`): 1 to 3 months, goals, weekly check-ins.
- **Confirm** (`confirmEmployee`): needs an approved final review at or above the confirm mark, no open plan; early confirmation is allowed for an approved review at 4.0 or more. Writes the confirmation letter.
- **Extend** (`extendEmployee`): once, only when the final score is between the plan mark and the confirm mark, with a plan.
- **Separate** (`separateEmployee`): needs the fairness checks (reviews on time, plan given) unless misconduct is recorded; needs the HR head's approval, which only an admin can record. Creates offboarding tasks and the termination letter text.
- **Surveys** at day 30 and 90; **letters** rendered from templates.

### 4.8 Board, reports, views, exports, privacy (`services/tracker.js`)

- `boardData` groups every candidate into a column. Each card's "Move to" menu offers only moves that have a real action behind them; the rest say why (for example, "use the candidate page, so the reason is recorded").
- `reportSummary` computes the funnel, key numbers and the definitions shown on hover. Each figure is computed in one place, so the dashboard and the reports page always agree.
- **Saved views** are stored per person (optionally shared). **Ready-made views** (`presetIds`) are computed from the database.
- **Exports**: candidates to Excel (`candidatesWorkbook`), the audit trail to CSV (`auditCsv`, admin only).
- **Privacy** (`anonymise`): only for closed candidates; removes personal details and documents, keeps the anonymous record for the reports. Every such change is audited.

### 4.9 Careers and the candidate portal (`services/portal.js`, `routes/public.js`)

- Published roles (`publishedRoles`) show only title, level, place, experience and skills — never the budget.
- Applying creates a candidate through the same intake as staff, with source "Careers page" and a private token. A duplicate or cooling-off case gives the same reply as a new application, so the form cannot reveal who has applied.
- The candidate's page (`/status/:token`) shows a plain message for their stage, their documents (upload), and their offer (typed-name acceptance, negotiate, or decline). It never shows internal notes, scores or salary policy.

### 4.10 Reminders (`reminders/`)

- `rules.js` (interviews, feedback, decisions, candidate updates, talent-pool follow-ups) and `rules2.js` (offers, laptop alerts, overdue tasks, check-ins, relieving letters, probation reviews, plan check-ins, surveys) each export a list of rules. A rule looks at the data and returns the nudges due now, with a `dedupeKey`.
- `engine.js` runs all rules, first expiring offers past their date. Reminders are stored once per key (`INSERT OR IGNORE`), so running the engine any number of times never repeats a nudge. Automatic reminders whose cause has gone (for example, feedback now submitted) are closed.
- The engine runs every 60 seconds (`server.js`) and on every read of `/api/reminders` and `/api/digest`.
- `store.js` writes reminders and turns @mentions in notes into reminders for the named person.
- Each reminder can carry ready-to-copy text, built from the message templates in Settings.

### 4.11 Settings and messages (`policy/`)

- `defaults.js` holds every number and message the process uses, with the PDF's values. `index.js` reads a value (`policy(db, 'ats.shortlistAt')`), and reads the stored override first.
- `schemas.js` validates every block before it is saved. The rules cannot be broken from the screen: weights must total 100, the review mark must be below the shortlist mark, and so on.
- `templates.js` holds the ready-made round plans.

### 4.12 Users, sessions, audit (`routes/users.js`, `auth/`, `audit/`)

- Admins manage the team; the last active admin cannot be removed, and nobody can remove their own admin access.
- Sessions last 12 hours. Changing a password ends every session for that person.
- `audit(db, {...})` is called by every state-changing service. `auditTrail()` reads a record's history.

## 5. Data model at a glance

| Table | What it holds |
| --- | --- |
| `users`, `sessions` | Team accounts, roles, active flag, time zone; hashed session tokens |
| `settings` | Overrides of the policy blocks (defaults live in code) |
| `audit_log` | Who did what, when, why, with before and after where useful |
| `requisitions`, `requisition_approvals`, `hiring_rounds` | The role, its approval steps, and its hiring plan |
| `candidates` | One row per application: contact, scoring, status, stage, phase, joining details, token |
| `candidate_events` | The timeline people read ("what happened") |
| `interview_rounds`, `interview_panel` | A candidate's rounds, their panel, and each member's feedback |
| `offers` | Every offer version, with status, approval, and the signature |
| `documents`, `document_files` | Checklist items and their uploaded files |
| `bgv_checks` | Background checks per candidate |
| `tasks`, `checkins` | Prep and offboarding tasks; notice-period check-ins |
| `employees`, `onboarding_items`, `assets` | The employee record, its checklists, and issued equipment |
| `reviews`, `goals`, `pips`, `pip_checkins`, `surveys` | Probation reviews, goals, improvement plans, and surveys |
| `reminders` | Nudges, one per key, with the person or role they are for |
| `saved_views` | Tracker views people saved |

Migrations are in `db/migrations.js`. They are append-only: a new change is a new entry, never an edit to an old one.

## 6. The web app

### 6.1 Structure

- `main.jsx` mounts the app with the query client, the router, and the global styles.
- `App.jsx` lists every route. Public routes (`/careers`, `/careers/:id`, `/status/:token`) are outside sign-in. Everything else is inside `RequireAuth`, and each screen is wrapped in `RequirePermission`, so a person who has no access to an area never sees its page.
- `components/AppShell.jsx` is the signed-in frame: the navigation (filtered by permission), the notification bell, and the account menu (appearance, change password, sign out).

### 6.2 Data flow

- `lib/api.js` is the only place that calls `fetch`. Errors become `ApiError` with the message, the code, and the per-field messages.
- `lib/data.js` holds every read as a hook (for example `useCandidate`, `useOffers`, `useBoard`) and every write as `useCommand`, which refreshes the query keys the change affects (`REFRESH_ALL_CANDIDATE`). Pages do not call `fetch` directly.
- `lib/auth.js` gives `useMe()` and `hasPermission(user, action)`. The permissions come from the server, so the screen and the API cannot disagree.
- `lib/format.js` holds all wording for statuses, stages, round types and dates, so the same thing always reads the same way.

### 6.3 Screens

- `features/candidates/CandidateDetail.jsx` is the most important screen. It chooses the one primary button from the candidate's state (`primaryFor`), and it shows the tabs for Overview, Interviews, Offer, Joining, Onboarding and probation, and Timeline. Its panels are `OfferPanel`, `JoiningPanel`, and `EmployeePanel`; its dialogs are in `dialogs.jsx` (`ActionDialog` is the one shell every dialog uses, so server errors always appear next to the right field).
- `features/requisitions/` — the role list, the four-step wizard, the detail page, the hiring-plan editor (`RoundsEditor`), and the approver picker.
- `features/board/BoardPage.jsx` — the kanban with "Move to" menus.
- `features/probation/ProbationPage.jsx` — the probation tracker.
- `features/reports/` — the key numbers and funnel, with exports.
- `features/public/PublicPages.jsx` — careers, apply, and the candidate's status page (no sign-in).
- `features/settings/SettingsPage.jsx` — every policy block, driven by one spec per area; totals are shown live; reset per block.

### 6.4 Conventions

- A dialog that changes something reaches the person through `ActionDialog`; the consequence is stated in plain words first.
- Destructive or outward actions (reject, revoke, separate, anonymise) ask first.
- Lists use `DataTable`, which has loading, error (with retry) and empty states built in.
- Colour is never the only signal: every status has words.

## 7. Business rules: where to look

| Rule | Where |
| --- | --- |
| Who may do what | `auth/permissions.js` |
| Role lifecycle, stage moves | `workflow/requisitions.js`, `workflow/candidates.js` |
| Screening score and cut-offs | `ats/scoring.js`, `policy/defaults.js` (ats) |
| Duplicate, cooling-off, undo windows | `services/candidates.js` (`createCandidate`, `rejectCandidate`, `undoReject`) |
| Reschedule limit, no-show rule, pass rules | `services/interviews.js`, `policy/defaults.js` (interviews) |
| Offer headcount, budget, expiry | `services/offers.js`, `policy/defaults.js` (offer) |
| Document and background-check rules | `services/joining.js` |
| Probation scoring, outcomes, extension, separation | `services/employees.js`, `policy/defaults.js` (probation) |
| Reminder timing | `reminders/rules.js`, `reminders/rules2.js` |

## 8. Errors and messages

- Business rules throw `rule(message, code, fields)`. The message is written for the person; the code tells the UI what to offer. Examples: `reschedule_limit`, `headcount_full`, `duplicate_warning`, `invalid_move`.
- Every write records the reason when one is required (rejection, hold, closing, separation, revoke).
- The server never shows internal errors to the user. They are logged on the server.

## 9. Adding a feature (the pattern)

1. Add the data: a new migration in `db/migrations.js` (never edit an old one).
2. Add the rule: a service function in `services/` that checks the rules, writes in a transaction, and records an event and an audit row.
3. Add the permission, if any, in `auth/permissions.js`, and a row in the matrix if you test it.
4. Add the route in `routes/`: parse, `needCan`, call the service, return the fresh view.
5. If it is a reminder, add a rule in `reminders/rules2.js` with a stable `dedupeKey`.
6. If people read a message, add the text to `policy/defaults.js` (templates) so HR can edit it.
7. Regenerate `docs/API.md` (`node` script in the scratch folder, or add it to the scripts).
8. On the web: add a hook in `lib/data.js`, a panel or dialog using `ActionDialog`, and wire it into the screen.

## 10. Status and known limits

- The server boots and the full hiring lifecycle runs through the API (requisition, approval, application, screening, interviews, offer, joining, onboarding, probation, confirmation). The screens were checked in a real browser for runtime errors.
- The automated test files from the earlier milestones (`server/test/`, `web/test/`) have not been updated for the new features and are not part of the current check. They are to be brought up to date later.
- Not built: real email and calendar sending (drafts are copied by hand), SSO, OCR for scanned resumes, file storage outside the database, and integrations with a background-check vendor or an e-signature service.
- `SESSION_SECRET` should be set outside development. `ADMIN_EMAIL` and `ADMIN_PASSWORD` create the first admin on an empty database.

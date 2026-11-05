# HireTrack API reference

Generated from `server/src/routes/` by reading each route and the permission it checks. Every path is under `/api`. Errors use one shape: `{ "error": "message for people", "code": "machine_code", "fields": { "field": "message" } }`.

Status codes: 400 bad input, 401 not signed in, 403 role not allowed, 404 not found, 409 someone else changed the record, 422 a business rule stopped the action (the `code` says which).

Permissions are defined in `server/src/auth/permissions.js`. "Signed in" means any signed-in person; the service checks the record-level rules (for example, interviewers see only their own candidates).

## Sign-in and account

| Method | Path | Who can call it |
| --- | --- | --- |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/logout` | Public |
| GET | `/api/auth/me` | Signed in |
| POST | `/api/auth/password` | Signed in |
| GET | `/api/auth/demo-accounts` | Public |

## Candidates and screening

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/candidates` | `candidate.read` |
| POST | `/api/candidates/parse-resume` | `candidate.write` |
| POST | `/api/candidates` | `candidate.write` |
| POST | `/api/candidates/bulk/reject` | `candidate.exit` |
| POST | `/api/candidates/bulk/assign` | `candidate.write` |
| GET | `/api/candidates/:id` | `candidate.read` |
| PATCH | `/api/candidates/:id` | `candidate.write` |
| POST | `/api/candidates/:id/knockouts` | `candidate.write` |
| POST | `/api/candidates/:id/notice-approval` | `candidate.write` |
| POST | `/api/candidates/:id/phone-screen` | `candidate.write` |
| POST | `/api/candidates/:id/start-interviews` | `round.schedule` |
| POST | `/api/candidates/:id/reject` | `candidate.exit` |
| POST | `/api/candidates/:id/undo-reject` | `candidate.exit` |
| POST | `/api/candidates/:id/withdraw` | `candidate.exit` |
| POST | `/api/candidates/:id/talent-pool` | `candidate.exit` |
| POST | `/api/candidates/:id/hold` | `candidate.write` |
| POST | `/api/candidates/:id/resume` | `candidate.write` |
| POST | `/api/candidates/:id/assign` | `candidate.write` |
| POST | `/api/candidates/:id/notes` | `candidate.read` |
| POST | `/api/candidates/:id/move-job` | `candidate.write` |
| GET | `/api/candidates/:id/history` | `candidate.read` |

## Onboarding and probation

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/employees` | `probation.read` |
| GET | `/api/employees/:id` | `probation.read` |
| POST | `/api/employees/:id/items/:key` | `onboarding.manage` |
| POST | `/api/employees/:id/assets` | `onboarding.manage` |
| POST | `/api/assets/:id/return` | `onboarding.manage` |
| POST | `/api/employees/:id/goals` | `probation.manage` |
| POST | `/api/employees/:id/reviews` | `probation.manage` |
| POST | `/api/employees/:id/reviews/:period/approve` | `probation.manage` |
| POST | `/api/employees/:id/pip` | `probation.manage` |
| POST | `/api/pips/:id/checkins` | `probation.manage` |
| POST | `/api/pips/:id/close` | `probation.manage` |
| POST | `/api/employees/:id/confirm` | `probation.manage` |
| POST | `/api/employees/:id/extend` | `probation.manage` |
| POST | `/api/employees/:id/separate` | `probation.manage` |
| POST | `/api/employees/:id/surveys` | `probation.manage` |
| GET | `/api/employees/:id/letters/:kind` | `probation.read` |

## Interview rounds

| Method | Path | Who can call it |
| --- | --- | --- |
| POST | `/api/rounds/:roundId/schedule` | `round.schedule` |
| POST | `/api/rounds/:roundId/no-show` | `round.schedule` |
| POST | `/api/rounds/:roundId/feedback` | `feedback.submit` |
| POST | `/api/rounds/:roundId/conflict` | `feedback.submit` |
| PUT | `/api/rounds/:roundId/panel` | `round.schedule` |
| GET | `/api/rounds/:roundId/suggest-panel` | `round.schedule` |
| POST | `/api/rounds/:roundId/resolve` | `candidate.exit` |
| POST | `/api/rounds/:roundId/resolve-hold` | `candidate.exit` |
| POST | `/api/rounds/:roundId/reissue-test` | `candidate.exit` |
| POST | `/api/rounds/:roundId/final` | `candidate.exit` |
| GET | `/api/rounds/:roundId/invite.ics` | `candidate.read` |

## Offers, documents, background checks and joining

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/candidates/:id/offers` | `joining.view` |
| POST | `/api/candidates/:id/offers` | `offer.manage` |
| POST | `/api/offers/:id/approve` | `offer.approve` |
| POST | `/api/candidates/:id/offers/revise` | `offer.manage` |
| POST | `/api/offers/:id/accept` | `offer.manage` |
| POST | `/api/offers/:id/negotiate` | `offer.manage` |
| POST | `/api/offers/:id/decline` | `offer.manage` |
| POST | `/api/offers/:id/extend` | `offer.manage` |
| POST | `/api/candidates/:id/revoke` | `offer.approve` |
| POST | `/api/candidates/:id/backed-out` | `offer.manage` |
| GET | `/api/candidates/:id/joining` | `joining.view` |
| POST | `/api/candidates/:id/documents/:docId/upload` | `joining.manage` |
| GET | `/api/documents/:docId/file` | `joining.manage` |
| POST | `/api/documents/:docId/review` | `joining.manage` |
| PUT | `/api/candidates/:id/bgv` | `joining.manage` |
| POST | `/api/tasks/:id/done` | `tasks.complete` |
| POST | `/api/candidates/:id/checkins` | `joining.view` |
| POST | `/api/candidates/:id/join-date` | `joining.manage` |
| POST | `/api/candidates/:id/people` | `joining.view` |
| POST | `/api/candidates/:id/relieving` | `joining.manage` |
| POST | `/api/candidates/:id/join` | `joining.manage` |
| POST | `/api/candidates/:id/day-one-no-show` | `joining.manage` |
| GET | `/api/candidates/:id/checklists` | `joining.manage` |

## Public: careers and candidate portal

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/careers` | Public (rate limited) |
| POST | `/api/careers/parse-resume` | Public (rate limited) |
| GET | `/api/careers/:id` | Public (rate limited) |
| POST | `/api/careers/:id/apply` | Public (rate limited) |
| GET | `/api/portal/:token` | Public (rate limited) |
| POST | `/api/portal/:token/documents/:docId` | Public (rate limited) |
| POST | `/api/portal/:token/respond` | Public (rate limited) |

## Reminders and digest

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/reminders` | Signed in |
| POST | `/api/reminders/:id/done` | Signed in |
| GET | `/api/digest` | Signed in |

## Roles and approvals

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/requisitions` | `requisition.read` |
| POST | `/api/requisitions` | `requisition.write` |
| GET | `/api/requisitions/approver-options` | `requisition.write` |
| GET | `/api/requisition-templates` | `requisition.read` |
| GET | `/api/requisitions/:id` | `requisition.read` |
| PATCH | `/api/requisitions/:id` | `requisition.write` |
| DELETE | `/api/requisitions/:id` | `requisition.write` |
| PUT | `/api/requisitions/:id/plan` | `requisition.write` |
| POST | `/api/requisitions/:id/plan/template` | `requisition.write` |
| POST | `/api/requisitions/:id/plan/copy` | `requisition.write` |
| POST | `/api/requisitions/:id/submit` | `requisition.write` |
| POST | `/api/requisitions/:id/approvals/:stepId/decide` | Signed in |
| POST | `/api/requisitions/:id/hold` | `requisition.write` |
| POST | `/api/requisitions/:id/reopen` | `requisition.write` |
| POST | `/api/requisitions/:id/close` | `requisition.write` |
| GET | `/api/requisitions/:id/history` | `requisition.read` |

## Settings

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/settings` | `settings.read` |
| PUT | `/api/settings/:block` | `settings.write` |
| POST | `/api/settings/:block/reset` | `settings.write` |

## Board, reports, views, exports and privacy

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/board` | `candidate.read` |
| POST | `/api/candidates/:id/board-move` | `candidate.write` |
| GET | `/api/reports/summary` | `reports.read` |
| GET | `/api/candidates/view` | `candidate.read` |
| GET | `/api/views` | `candidate.read` |
| POST | `/api/views` | `candidate.write` |
| DELETE | `/api/views/:id` | `candidate.write` |
| GET | `/api/candidates/export.xlsx` | `reports.read` |
| GET | `/api/audit/export.csv` | `audit.read` |
| POST | `/api/candidates/:id/anonymise` | `candidate.anonymise` |
| POST | `/api/requisitions/:id/publish` | `requisition.write` |

## Team (admin)

| Method | Path | Who can call it |
| --- | --- | --- |
| GET | `/api/people` | `candidate.write` |
| GET | `/api/users` | `users.manage` |
| POST | `/api/users` | `users.manage` |
| PATCH | `/api/users/:id` | `users.manage` |

---
Total routes: 120.

/**
 * Ordered, append-only schema migrations. Never edit a shipped entry; add a new one.
 * Index i is version i + 1 (tracked in PRAGMA user_version).
 */
export const migrations = [
  // v1: foundation. Settings (policy values), users, audit trail.
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,            -- JSON
    updated_at TEXT NOT NULL
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('HR','RECRUITER','INTERVIEWER','IT','ADMIN')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    at          TEXT NOT NULL,           -- ISO instant, UTC
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,           -- e.g. candidate.advance
    entity      TEXT NOT NULL,           -- e.g. candidate
    entity_id   INTEGER,
    reason      TEXT,
    detail      TEXT                     -- JSON, before/after where useful
  );
  CREATE INDEX audit_entity ON audit_log(entity, entity_id);
  `,

  // v2 (M1): login sessions. Only a SHA-256 hash of each token is stored.
  `
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  `,

  // v3 (M2): requisitions, their approval chain, and the hiring plan (the rounds for each job).
  `
  CREATE TABLE requisitions (
    id               INTEGER PRIMARY KEY,
    title            TEXT NOT NULL,
    level            TEXT,
    headcount        INTEGER NOT NULL DEFAULT 1,
    team             TEXT,
    location         TEXT,
    remote           INTEGER NOT NULL DEFAULT 0,
    budget_max_lpa   REAL,
    target_join_date TEXT,
    jd_text          TEXT NOT NULL DEFAULT '',
    must_skills      TEXT NOT NULL DEFAULT '[]',
    good_skills      TEXT NOT NULL DEFAULT '[]',
    exp_min          REAL,
    exp_max          REAL,
    notice_max_days  INTEGER,
    status           TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','PENDING_APPROVAL','REJECTED','OPEN','ON_HOLD','CLOSED')),
    status_reason    TEXT,
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    version          INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE requisition_approvals (
    id             INTEGER PRIMARY KEY,
    requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    label          TEXT NOT NULL,
    approver_id    INTEGER NOT NULL REFERENCES users(id),
    status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    comment        TEXT,
    decided_at     TEXT
  );
  CREATE INDEX approvals_req ON requisition_approvals(requisition_id, position);

  CREATE TABLE hiring_rounds (
    id             INTEGER PRIMARY KEY,
    requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('ONLINE_TEST','TAKE_HOME','SCORECARD','DECISION','FINAL_APPROVAL')),
    duration_min   INTEGER,
    format         TEXT NOT NULL DEFAULT '',
    who            TEXT NOT NULL DEFAULT '',
    pass_percent   REAL,
    pass_average   REAL,
    skills         TEXT NOT NULL DEFAULT '[]',
    optional       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX rounds_req ON hiring_rounds(requisition_id, position);
  `,

  // v4 (M3 + M4): candidates (one row per application), their timeline, and interview rounds with panels.
  `
  ALTER TABLE users ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

  CREATE TABLE candidates (
    id              INTEGER PRIMARY KEY,
    requisition_id  INTEGER NOT NULL REFERENCES requisitions(id),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    pan             TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT '',
    source_detail   TEXT NOT NULL DEFAULT '',
    experience_years REAL,
    current_ctc_lpa REAL,
    expected_ctc_lpa REAL,
    notice_days     INTEGER,
    work_auth       INTEGER,
    shift_ok        INTEGER,
    resume_text     TEXT NOT NULL DEFAULT '',
    portfolio_url   TEXT NOT NULL DEFAULT '',
    github_url      TEXT NOT NULL DEFAULT '',
    stage           TEXT NOT NULL DEFAULT 'SCREENING' CHECK (stage IN ('SCREENING','INTERVIEWS','SELECTED','CLOSED')),
    status          TEXT NOT NULL DEFAULT 'New',
    ats_score       REAL,
    ats_breakdown   TEXT NOT NULL DEFAULT '{}',
    matched_skills  TEXT NOT NULL DEFAULT '[]',
    missing_skills  TEXT NOT NULL DEFAULT '[]',
    flags           TEXT NOT NULL DEFAULT '[]',
    on_hold         INTEGER NOT NULL DEFAULT 0,
    hold_reason     TEXT,
    phone_screen_notes TEXT NOT NULL DEFAULT '',
    notice_approved_by TEXT,
    follow_up_date  TEXT,
    owner_id        INTEGER REFERENCES users(id),
    linked_to_id    INTEGER REFERENCES candidates(id),
    closed_reason   TEXT,
    rejected_at     TEXT,
    reject_reason   TEXT,
    reject_undo_until TEXT,
    undo_snapshot   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX candidates_req ON candidates(requisition_id);
  CREATE INDEX candidates_email ON candidates(email COLLATE NOCASE);

  CREATE TABLE candidate_events (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    at           TEXT NOT NULL,
    user_id      INTEGER REFERENCES users(id),
    kind         TEXT NOT NULL,           -- note | system | decision
    text         TEXT NOT NULL
  );
  CREATE INDEX events_candidate ON candidate_events(candidate_id, id);

  CREATE TABLE interview_rounds (
    id               INTEGER PRIMARY KEY,
    candidate_id     INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    hiring_round_id  INTEGER REFERENCES hiring_rounds(id),
    position         INTEGER NOT NULL,
    name             TEXT NOT NULL,
    type             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'WAITING'
                     CHECK (status IN ('WAITING','TO_SCHEDULE','SCHEDULED','NO_SHOW','PASSED','FAILED',
                                       'DECISION_NEEDED','HELD','PENDING_FINAL','SUPERSEDED','SELECTED')),
    scheduled_at    TEXT,
    time_zone       TEXT,
    link            TEXT NOT NULL DEFAULT '',
    reschedules     INTEGER NOT NULL DEFAULT 0,
    no_shows        INTEGER NOT NULL DEFAULT 0,
    test_score      REAL,
    test_reissued   INTEGER NOT NULL DEFAULT 0,
    integrity_flag  INTEGER NOT NULL DEFAULT 0,
    result_note     TEXT,
    decided_at      TEXT
  );
  CREATE INDEX ir_candidate ON interview_rounds(candidate_id, position);

  CREATE TABLE interview_panel (
    id                INTEGER PRIMARY KEY,
    interview_round_id INTEGER NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    conflict          INTEGER NOT NULL DEFAULT 0,
    conflict_note     TEXT,
    scores            TEXT,                -- JSON {skill: 1..5}
    avg               REAL,
    recommendation    TEXT CHECK (recommendation IN ('HIRE','NO_HIRE')),
    comments          TEXT,
    submitted_at      TEXT,
    UNIQUE (interview_round_id, user_id)
  );
  `,

  // v5 (M5): reminders and notifications. One row per nudge; dedupe_key stops the same nudge repeating.
  `
  CREATE TABLE reminders (
    id               INTEGER PRIMARY KEY,
    dedupe_key       TEXT NOT NULL UNIQUE,
    kind             TEXT NOT NULL,
    title            TEXT NOT NULL,
    body             TEXT NOT NULL DEFAULT '',
    due_at           TEXT NOT NULL,
    candidate_id     INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
    round_id         INTEGER REFERENCES interview_rounds(id) ON DELETE CASCADE,
    audience_user_id INTEGER REFERENCES users(id),
    audience_role    TEXT,
    auto             INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    done_at          TEXT
  );
  CREATE INDEX reminders_open ON reminders(done_at, due_at);
  `,
  // v6 (M6): offers (versioned), documents with files, background checks, prep tasks, check-ins.
  `
  ALTER TABLE candidates ADD COLUMN phase TEXT NOT NULL DEFAULT '';
  ALTER TABLE candidates ADD COLUMN join_date TEXT;
  ALTER TABLE candidates ADD COLUMN join_date_changes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE candidates ADD COLUMN subject_to_bgv INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE candidates ADD COLUMN buddy TEXT NOT NULL DEFAULT '';
  ALTER TABLE candidates ADD COLUMN manager TEXT NOT NULL DEFAULT '';
  ALTER TABLE candidates ADD COLUMN relieving_status TEXT NOT NULL DEFAULT 'NA';
  ALTER TABLE candidates ADD COLUMN relieving_due TEXT;
  ALTER TABLE candidates ADD COLUMN token TEXT;
  ALTER TABLE candidates ADD COLUMN applied_via TEXT NOT NULL DEFAULT 'HR';
  ALTER TABLE candidates ADD COLUMN anonymised_at TEXT;
  CREATE UNIQUE INDEX candidates_token ON candidates(token);
  ALTER TABLE requisitions ADD COLUMN published INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE offers (
    id            INTEGER PRIMARY KEY,
    candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL DEFAULT 1,
    ctc_lpa       REAL NOT NULL,
    fixed_lpa     REAL,
    join_date     TEXT NOT NULL,
    expiry_date   TEXT NOT NULL,
    extensions    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL','SENT','NEGOTIATING','ACCEPTED','DECLINED','EXPIRED','REVOKED','SUPERSEDED')),
    above_budget  INTEGER NOT NULL DEFAULT 0,
    backup        INTEGER NOT NULL DEFAULT 0,
    approved_by   TEXT,
    letter        TEXT NOT NULL DEFAULT '',
    sign_name     TEXT,
    sign_at       TEXT,
    response_note TEXT,
    created_at    TEXT NOT NULL,
    created_by    INTEGER REFERENCES users(id)
  );
  CREATE INDEX offers_candidate ON offers(candidate_id, version);

  CREATE TABLE documents (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    doc_type     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','SUBMITTED','VERIFIED','REJECTED','LATER','AFFIDAVIT')),
    reason       TEXT,
    note         TEXT,
    verified_by  TEXT,
    updated_at   TEXT NOT NULL,
    UNIQUE (candidate_id, doc_type)
  );
  CREATE TABLE document_files (
    document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    data        BLOB NOT NULL,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE bgv_checks (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    check_type   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','CLEAR','FLAGGED')),
    note         TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL,
    UNIQUE (candidate_id, check_type)
  );

  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    owner_team   TEXT NOT NULL CHECK (owner_team IN ('HR','IT','ADMIN')),
    kind         TEXT NOT NULL CHECK (kind IN ('PREP','OFFBOARD')),
    offset_days  INTEGER,
    due_on       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
    done_at      TEXT,
    done_by      INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL
  );
  CREATE INDEX tasks_candidate ON tasks(candidate_id, status);

  CREATE TABLE checkins (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    at           TEXT NOT NULL,
    user_id      INTEGER REFERENCES users(id),
    note         TEXT NOT NULL
  );
  `,

  // v7 (M7): employees after joining, onboarding items, assets, probation reviews, PIPs, surveys, goals.
  `
  CREATE TABLE employees (
    id                INTEGER PRIMARY KEY,
    candidate_id      INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
    employee_code     TEXT NOT NULL UNIQUE,
    company_email     TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    joined_on         TEXT NOT NULL,
    probation_start   TEXT,
    probation_end     TEXT,
    status            TEXT NOT NULL DEFAULT 'ONBOARDING' CHECK (status IN ('ONBOARDING','PROBATION','CONFIRMED','SEPARATED')),
    access_restricted INTEGER NOT NULL DEFAULT 0,
    extended          INTEGER NOT NULL DEFAULT 0,
    separated_on      TEXT,
    separation_reason TEXT,
    rehire_eligible   INTEGER,
    created_at        TEXT NOT NULL
  );

  CREATE TABLE onboarding_items (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    item_key    TEXT NOT NULL,
    label       TEXT NOT NULL,
    owner_team  TEXT NOT NULL CHECK (owner_team IN ('HR','IT','ADMIN')),
    kind        TEXT NOT NULL CHECK (kind IN ('DAY1','ACCESS')),
    done        INTEGER NOT NULL DEFAULT 0,
    done_at     TEXT,
    done_by     INTEGER REFERENCES users(id),
    UNIQUE (employee_id, item_key)
  );

  CREATE TABLE assets (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    asset_type  TEXT NOT NULL CHECK (asset_type IN ('LAPTOP','ID_CARD','HEADSET','ACCESS_CARD')),
    serial      TEXT NOT NULL DEFAULT '',
    loaner      INTEGER NOT NULL DEFAULT 0,
    issued_at   TEXT NOT NULL,
    returned_at TEXT
  );

  CREATE TABLE goals (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period      TEXT NOT NULL,
    text        TEXT NOT NULL,
    due_on      TEXT
  );

  CREATE TABLE reviews (
    id              INTEGER PRIMARY KEY,
    employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period          TEXT NOT NULL CHECK (period IN ('30','60','90','FINAL')),
    scores          TEXT NOT NULL,
    self_scores     TEXT,
    weighted        REAL NOT NULL,
    outcome         TEXT NOT NULL,
    lead_comments   TEXT NOT NULL DEFAULT '',
    buddy_comments  TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL CHECK (status IN ('SUBMITTED','APPROVED')),
    submitted_by    TEXT,
    submitted_at    TEXT NOT NULL,
    approved_by     TEXT,
    approved_at     TEXT,
    UNIQUE (employee_id, period)
  );

  CREATE TABLE pips (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    months      INTEGER NOT NULL,
    goals       TEXT NOT NULL,
    start_on    TEXT NOT NULL,
    end_on      TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ACTIVE','PASSED','FAILED')),
    reason      TEXT
  );
  CREATE TABLE pip_checkins (
    id      INTEGER PRIMARY KEY,
    pip_id  INTEGER NOT NULL REFERENCES pips(id) ON DELETE CASCADE,
    at      TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    note    TEXT NOT NULL
  );

  CREATE TABLE surveys (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day         INTEGER NOT NULL,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT NOT NULL DEFAULT '',
    recorded_at TEXT NOT NULL,
    UNIQUE (employee_id, day)
  );
  `,

  // v8 (M8): saved tracker views.
  `
  CREATE TABLE saved_views (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    filters    TEXT NOT NULL,
    shared     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
];

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Undo2, Download, CheckCircle2, Circle } from 'lucide-react';
import { post, put, patch, ApiError } from '../../lib/api.js';
import { useCandidate, useHistory, useSettings, useCommand, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { useMe, hasPermission } from '../../lib/auth.js';
import {
  STAGE_TEXT, statusTone, scoreTone, fmtDate, fmtDateTime, fmtAgo, lpa, browserZone,
  ROUND_STATUS_TEXT, ROUND_STATUS_TONE, ROUND_TYPE_TEXT, SOURCES,
} from '../../lib/format.js';
import { Button, Dialog, Pill, PageHeader, Field, Skeleton, EmptyState, ConfirmDialog } from '../../components/ui.jsx';
import { TabBar, TabPanel, ActionMenu, Facts, Section, Score } from '../../components/kit.jsx';
import OfferPanel from './OfferPanel.jsx';
import JoiningPanel from './JoiningPanel.jsx';
import EmployeePanel from './EmployeePanel.jsx';
import {
  PhoneScreenDialog, NoticeApprovalDialog, RejectDialog, RejectionDraftDialog, WithdrawDialog, TalentPoolDialog,
  HoldDialog, MoveJobDialog, AssignDialog, NoteDialog, ScheduleDialog, NoShowDialog, FeedbackDialog,
  ConflictDialog, PanelDialog, DecideRoundDialog, ResolveHoldDialog, ReissueDialog, FinalDialog,
} from './dialogs.jsx';
import { Select } from '../../components/Select.jsx';

const isOpenRound = (r) => !['WAITING', 'PASSED', 'SUPERSEDED', 'SELECTED'].includes(r.status);

/** The one button that moves this candidate forward, chosen from where they are right now. */
function primaryFor(c, rounds, me, undoable, canSalary) {
  if (c.stage === 'CLOSED') return undoable ? { key: 'undo', label: 'Undo rejection' } : null;
  if (c.onHold) return { key: 'resume', label: 'Resume candidate' };
  if (c.stage === 'SCREENING') {
    if (c.status === 'Shortlisted') return { key: 'phone', label: 'Hold the phone screen' };
    if (c.status === 'Shortlisted for interviews') return { key: 'start', label: 'Start interviews' };
    if (c.status === 'Phone screen failed') return { key: 'reject', label: 'Reject candidate' };
    if (c.flags?.some((f) => f.includes('needs manager approval')) && !c.noticeApprovedBy) return { key: 'notice', label: 'Approve long notice period' };
    if (c.status === 'Below cut-off') return undoable ? { key: 'undo', label: 'Undo rejection' } : null;
    return { key: 'tab:overview', label: 'Check knock-out questions' };
  }
  if (c.stage === 'INTERVIEWS') {
    const r = rounds.find(isOpenRound);
    if (!r) return null;
    const onPanel = r.panel?.find((p) => p.userId === me?.id && !p.submittedAt && !p.conflict);
    if (r.status === 'TO_SCHEDULE' || r.status === 'NO_SHOW') return { key: `schedule:${r.id}`, label: `Schedule ${r.name}` };
    if (r.status === 'SCHEDULED' && onPanel) return { key: `feedback:${r.id}`, label: `Add feedback for ${r.name}` };
    if (r.status === 'SCHEDULED' && r.type === 'ONLINE_TEST') return { key: `feedback:${r.id}`, label: 'Enter the test score' };
    if (r.status === 'FAILED' || r.status === 'DECISION_NEEDED') return { key: `decide:${r.id}`, label: `Decide on ${r.name}` };
    if (r.status === 'HELD') return { key: `resolvehold:${r.id}`, label: 'Review the integrity concern' };
    if (r.status === 'PENDING_FINAL') return { key: `final:${r.id}`, label: 'Give final approval' };
    return null;
  }
  if (c.stage === 'SELECTED') {
    if (c.phase === 'OFFER' || !c.phase) return canSalary ? { key: 'tab:offer', label: 'Make or record an offer' } : null;
    if (c.phase === 'PRE_JOINING') return { key: 'tab:joining', label: 'Joining checklist' };
    if (c.phase === 'ONBOARDING' || c.phase === 'PROBATION') return { key: 'tab:employee', label: 'Onboarding and probation' };
    if (c.phase === 'CONFIRMED') return { key: 'tab:employee', label: 'Confirmed: view the letter' };
  }
  return null;
}

export default function CandidateDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const me = useMe();
  const { data: c, isPending, error, refetch } = useCandidate(cid);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState(null);
  const qc = useQueryClient();
  const settings = useSettings();

  const undo = useCommand(() => post(`/api/candidates/${cid}/undo-reject`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Rejection undone. They are back in the process.' });
  const resume = useCommand(() => post(`/api/candidates/${cid}/resume`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Back in the process.' });

  if (isPending) return <Skeleton rows={6} />;
  if (error) {
    return <div role="alert" className="banner bad">{error.message} <Button onClick={() => refetch()}>Try again</Button></div>;
  }

  const rounds = c.rounds ?? [];
  const activeRound = rounds.find(isOpenRound);
  const canWrite = hasPermission(me.data, 'candidate.write');
  const canExit = hasPermission(me.data, 'candidate.exit');
  const undoable = !!c.rejectUndoUntil && new Date(c.rejectUndoUntil) > new Date() && c.closedReason === 'Rejected';
  const canSalary = hasPermission(me.data, 'salary.read');
  const primary = primaryFor(c, rounds, me.data, undoable, canSalary);
  const roundFor = (rid) => rounds.find((r) => r.id === rid);

  const onPrimary = (key) => {
    if (!key) return;
    if (key === 'undo') return undo.mutate();
    if (key === 'resume') return resume.mutate();
    if (key.startsWith('tab:')) return setTab(key.slice(4));
    if (key === 'reject') return setDialog({ kind: 'reject' });
    if (key === 'notice') return setDialog({ kind: 'notice' });
    if (key === 'phone') return setDialog({ kind: 'phone' });
    if (key === 'start') return startInterviews();
    const [kind, rid] = key.split(':');
    setDialog({ kind, round: roundFor(Number(rid)) });
  };

  async function startInterviews() {
    try {
      await post(`/api/candidates/${cid}/start-interviews`, {});
      REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success('Interview rounds started.');
    } catch (e) { toast.error(e.message); }
  }

  const weights = settings.data?.values?.ats?.weights;

  return (
    <>
      <PageHeader
        title={c.name}
        lead={
          <span>
            <Link to={`/requisitions/${c.requisitionId}`}>{c.requisitionTitle}</Link>
            {c.location && <span className="muted"> · {c.location}</span>}
            {c.ownerName && <span className="muted"> · Owner {c.ownerName}</span>}
          </span>
        }
        actions={
          <div className="page-actions">
            <Pill tone={c.stage === 'CLOSED' ? 'neutral' : 'accent'}>{STAGE_TEXT[c.stage]}</Pill>
            <Pill tone={statusTone(c.status)}>{c.status}</Pill>
            {c.onHold && <Pill tone="warn">On hold</Pill>}
            {primary && (
              <Button variant="primary" onClick={() => onPrimary(primary.key)} disabled={undo.isPending || resume.isPending}>
                {primary.label} <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
            {canWrite && c.stage === 'CLOSED' && hasPermission(me.data, 'candidate.anonymise') && c.closedReason !== null && (
              <ActionMenu items={[{ label: 'Remove personal details', tone: 'danger', onSelect: () => setDialog({ kind: 'anonymise' }) }]} />
            )}
            {canWrite && c.stage !== 'CLOSED' && (
              <ActionMenu items={[
                { label: 'Add a note', onSelect: () => setDialog({ kind: 'note' }) },
                { label: c.onHold ? 'Resume' : 'Put on hold', onSelect: () => (c.onHold ? resume.mutate() : setDialog({ kind: 'hold' })) },
                { label: 'Move to another role', onSelect: () => setDialog({ kind: 'move' }) },
                { label: 'Change owner', onSelect: () => setDialog({ kind: 'assign' }) },
                canExit && { label: 'Keep in talent pool', onSelect: () => setDialog({ kind: 'pool' }) },
                canExit && { label: 'They withdrew', onSelect: () => setDialog({ kind: 'withdraw' }) },
                canExit && { label: 'Reject', tone: 'danger', onSelect: () => setDialog({ kind: 'reject' }) },
              ].filter(Boolean)} />
            )}
          </div>
        }
      />

      {undoable && (
        <p role="status" className="banner bad">
          Rejected. You can undo this until {fmtDateTime(c.rejectUndoUntil, browserZone())}.
          <Button onClick={() => undo.mutate()}><Undo2 size={16} aria-hidden="true" /> Undo</Button>
        </p>
      )}
      {c.stage === 'CLOSED' && !undoable && (
        <p role="status" className="banner accent">Closed: {c.closedReason}{c.rejectReason ? ` · ${c.rejectReason}` : ''}</p>
      )}
      {c.stage !== 'CLOSED' && c.nextAction && !primary && (
        <p role="status" className="banner accent">Next: {c.nextAction}</p>
      )}

      <TabBar value={tab} onValueChange={setTab} items={[
        { value: 'overview', label: 'Overview' },
        { value: 'interviews', label: 'Interviews', count: rounds.length || undefined },
        c.stage === 'SELECTED' && canSalary && { value: 'offer', label: 'Offer' },
        c.stage === 'SELECTED' && c.phase && c.phase !== 'OFFER' && c.phase !== 'CONFIRMED' && { value: 'joining', label: 'Joining' },
        c.employeeId && { value: 'employee', label: 'Onboarding and probation' },
        { value: 'timeline', label: 'Timeline' },
      ].filter(Boolean)}>
        <TabPanel value="overview" className="tab-body">
          <Overview c={c} canWrite={canWrite} weights={weights} me={me.data} />
        </TabPanel>
        <TabPanel value="interviews" className="tab-body">
          <Interviews
            c={c}
            rounds={rounds}
            me={me.data}
            canSchedule={hasPermission(me.data, 'round.schedule')}
            canExit={canExit}
            onAction={(kind, round) => setDialog({ kind, round })}
          />
        </TabPanel>
        <TabPanel value="offer" className="tab-body">
          <OfferPanel c={c} />
        </TabPanel>
        <TabPanel value="joining" className="tab-body">
          <JoiningPanel c={c} />
        </TabPanel>
        <TabPanel value="employee" className="tab-body">
          <EmployeePanel c={c} />
        </TabPanel>
        <TabPanel value="timeline" className="tab-body">
          <Timeline candidateId={cid} />
        </TabPanel>
      </TabBar>

      {/* dialogs */}
      <PhoneScreenDialog open={dialog?.kind === 'phone'} onClose={() => setDialog(null)} candidate={c} />
      <NoticeApprovalDialog open={dialog?.kind === 'notice'} onClose={() => setDialog(null)} candidate={c} />
      <RejectDialog open={dialog?.kind === 'reject'} onClose={() => setDialog(null)} candidate={c}
        onRejected={(res) => {
          setDraft(res.rejectionDraft);
          const until = res.undoUntil;
          toast(`Rejected ${c.name}. Undo is possible until ${fmtDateTime(until, browserZone())}.`, {
            duration: 10 * 60_000,
            action: { label: 'Undo', onClick: () => post(`/api/candidates/${cid}/undo-reject`, {}).then(() => { REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k })); toast.success('Rejection undone.'); }).catch((e) => toast.error(e.message)) },
          });
        }} />
      <ConfirmDialog open={dialog?.kind === 'anonymise'} title={`Remove personal details of ${c.name}?`} tone="danger"
        confirmLabel="Remove details" onCancel={() => setDialog(null)}
        consequence="Name, contact details, resume and documents are deleted. The record stays so the reports still add up. This cannot be undone."
        onConfirm={async () => {
          setDialog(null);
          try {
            await post(`/api/candidates/${cid}/anonymise`, {});
            REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
            toast.success('Personal details removed.');
          } catch (e) { toast.error(e.message); }
        }} />
      <RejectionDraftDialog open={!!draft} draft={draft ?? ''} onClose={() => setDraft(null)} />
      <WithdrawDialog open={dialog?.kind === 'withdraw'} onClose={() => setDialog(null)} candidate={c} />
      <TalentPoolDialog open={dialog?.kind === 'pool'} onClose={() => setDialog(null)} candidate={c} />
      <HoldDialog open={dialog?.kind === 'hold'} onClose={() => setDialog(null)} candidate={c} />
      <MoveJobDialog open={dialog?.kind === 'move'} onClose={() => setDialog(null)} candidate={c} />
      <AssignDialog open={dialog?.kind === 'assign'} onClose={() => setDialog(null)} candidate={c} />
      <NoteDialog open={dialog?.kind === 'note'} onClose={() => setDialog(null)} candidate={c} />
      {dialog?.round && (
        <>
          <ScheduleDialog open={dialog.kind === 'schedule'} onClose={() => setDialog(null)} round={dialog.round} me={me.data} />
          <NoShowDialog open={dialog.kind === 'noshow'} onClose={() => setDialog(null)} round={dialog.round} me={me.data} />
          <FeedbackDialog open={dialog.kind === 'feedback'} onClose={() => setDialog(null)} round={dialog.round} me={me.data} />
          <ConflictDialog open={dialog.kind === 'conflict'} onClose={() => setDialog(null)} round={dialog.round} />
          <PanelDialog open={dialog.kind === 'panel'} onClose={() => setDialog(null)} round={dialog.round} />
          <DecideRoundDialog open={dialog.kind === 'decide'} onClose={() => setDialog(null)} round={dialog.round} />
          <ResolveHoldDialog open={dialog.kind === 'resolvehold'} onClose={() => setDialog(null)} round={dialog.round} />
          <ReissueDialog open={dialog.kind === 'reissue'} onClose={() => setDialog(null)} round={dialog.round} />
          <FinalDialog open={dialog.kind === 'final'} onClose={() => setDialog(null)} round={dialog.round} />
        </>
      )}
    </>
  );
}

/* ---------- Overview ---------- */

function Overview({ c, canWrite, weights, me }) {
  const showSalary = c.canSeeSalary;
  return (
    <div className="stack-lg">
      <div className="two-col">
        <Section id="screen" title="Screening score">
          <div className="score-line">
            <Score value={c.atsScore} band={scoreTone(c.atsScore)} />
            <span className="muted small">out of 100</span>
          </div>
          {c.atsBreakdown && Object.keys(c.atsBreakdown).length > 0 && (
            <ul className="breakdown">
              {[
                ['mustHave', 'Must-have skills'], ['experience', 'Experience'], ['goodToHave', 'Good-to-have skills'],
                ['education', 'Education and certificates'], ['stability', 'Stability (job gaps)'],
              ].map(([k, label]) => {
                const max = weights?.[k];
                const got = c.atsBreakdown[k] ?? 0;
                return (
                  <li key={k}>
                    <span>{label}</span>
                    <span className="num">{got}{max != null ? ` of ${max}` : ''}</span>
                    {max != null && <meter min="0" max={max} value={got} aria-label={label} />}
                  </li>
                );
              })}
            </ul>
          )}
          {c.matchedSkills?.length > 0 && <p className="small"><strong>Found:</strong> {c.matchedSkills.join(', ')}</p>}
          {c.missingSkills?.length > 0 && <p className="small"><strong>Missing:</strong> {c.missingSkills.join(', ')}</p>}
        </Section>

        <Section id="flags" title="Things to check">
          {c.flags?.length ? (
            <ul className="flags">{c.flags.map((f) => <li key={f}>{f}</li>)}</ul>
          ) : <p className="muted">Nothing flagged.</p>}
          {c.noticeApprovedBy && <p className="small muted mt">Long notice approved by {c.noticeApprovedBy}.</p>}
          <Facts items={[
            { label: 'Source', value: [c.source, c.sourceDetail].filter(Boolean).join(' · ') },
            { label: 'Experience', value: c.experienceYears != null ? `${c.experienceYears} years` : null },
            { label: 'Notice period', value: c.noticeDays != null ? `${c.noticeDays} days` : null },
            { label: 'Work permit', value: c.workAuth == null ? null : c.workAuth ? 'Yes' : 'No' },
            { label: 'Shift fit', value: c.shiftOk == null ? null : c.shiftOk ? 'Yes' : 'No' },
            showSalary
              ? { label: 'Current salary', value: lpa(c.currentCtcLpa) }
              : null,
            showSalary
              ? { label: 'Expected salary', value: lpa(c.expectedCtcLpa) }
              : { label: 'Salary', value: c.ctcWithinBudget == null ? null : c.ctcWithinBudget ? 'Within budget' : 'Above budget' },
          ].filter(Boolean)} />
        </Section>
      </div>

      <ContactForm c={c} canWrite={canWrite} />
      <KnockoutForm c={c} canWrite={canWrite} showSalary={showSalary} />
    </div>
  );
}

function ContactForm({ c, canWrite }) {
  const qc = useQueryClient();
  const [v, setV] = useState(() => ({
    name: c.name, email: c.email, phone: c.phone, location: c.location, portfolioUrl: c.portfolioUrl,
    githubUrl: c.githubUrl, resumeText: c.resumeText, experienceYears: c.experienceYears ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (k) => ({ value: v[k] ?? '', disabled: !canWrite, onChange: (e) => setV((s) => ({ ...s, [k]: e.target.value })) });
  const dirty = JSON.stringify(v) !== JSON.stringify({
    name: c.name, email: c.email, phone: c.phone, location: c.location, portfolioUrl: c.portfolioUrl,
    githubUrl: c.githubUrl, resumeText: c.resumeText, experienceYears: c.experienceYears ?? '',
  });

  async function save() {
    setBusy(true); setErrors({}); setMessage('');
    try {
      await patch(`/api/candidates/${c.id}`, {
        version: c.version,
        ...v,
        experienceYears: v.experienceYears === '' ? null : Number(v.experienceYears),
      });
      REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success('Saved. The resume has been scored again.');
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fields ?? {}); setMessage(e.message); }
    } finally { setBusy(false); }
  }

  return (
    <Section id="contact" title="Contact and resume" action={canWrite && (
      <Button variant="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Button>
    )}>
      <div className="form-grid">
        <Field label="Full name" error={errors.name}>{(p) => <input {...p} {...bind('name')} />}</Field>
        <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" {...bind('email')} />}</Field>
        <Field label="Phone" error={errors.phone}>{(p) => <input {...p} {...bind('phone')} />}</Field>
        <Field label="Location" error={errors.location}>{(p) => <input {...p} {...bind('location')} />}</Field>
        <Field label="Years of experience" error={errors.experienceYears}>{(p) => <input {...p} type="number" step="0.5" {...bind('experienceYears')} />}</Field>
        <Field label="Portfolio or LinkedIn link" error={errors.portfolioUrl}>{(p) => <input {...p} {...bind('portfolioUrl')} />}</Field>
        <Field label="GitHub link" error={errors.githubUrl}>{(p) => <input {...p} {...bind('githubUrl')} />}</Field>
      </div>
      <Field label="Resume text" error={errors.resumeText} hint="Changing this scores the resume again.">
        {(p) => <textarea {...p} rows={8} {...bind('resumeText')} />}
      </Field>
      {message && <p role="alert" className="banner bad mt">{message}</p>}
    </Section>
  );
}

function KnockoutForm({ c, canWrite, showSalary }) {
  const qc = useQueryClient();
  const [v, setV] = useState(() => ({
    currentCtcLpa: c.currentCtcLpa ?? '', expectedCtcLpa: c.expectedCtcLpa ?? '', noticeDays: c.noticeDays ?? '',
    workAuth: c.workAuth == null ? '' : String(c.workAuth), shiftOk: c.shiftOk == null ? '' : String(c.shiftOk), location: c.location ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const tri = (x) => (x === '' ? null : x === 'true');
  const bind = (k) => ({ value: v[k], disabled: !canWrite, onChange: (e) => setV((s) => ({ ...s, [k]: e.target.value })) });

  async function save() {
    setBusy(true); setErrors({});
    try {
      const body = {
        expectedCtcLpa: v.expectedCtcLpa === '' ? null : Number(v.expectedCtcLpa),
        noticeDays: v.noticeDays === '' ? null : Number(v.noticeDays),
        workAuth: tri(v.workAuth), shiftOk: tri(v.shiftOk), location: v.location,
        ...(showSalary ? { currentCtcLpa: v.currentCtcLpa === '' ? null : Number(v.currentCtcLpa) } : {}),
      };
      await post(`/api/candidates/${c.id}/knockouts`, body);
      REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success('Knock-out answers saved.');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields ?? {});
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Section id="knockouts" title="Knock-out questions" action={canWrite && <Button variant="primary" disabled={busy} onClick={save}>Save answers</Button>}>
      <p className="muted small">Ask these on the phone screen. Answers feed the flags above.</p>
      <div className="form-grid">
        {showSalary && (
          <Field label="Current salary (LPA)" error={errors.currentCtcLpa}>{(p) => <input {...p} type="number" step="0.5" {...bind('currentCtcLpa')} />}</Field>
        )}
        <Field label="Expected salary (LPA)" error={errors.expectedCtcLpa}>{(p) => <input {...p} type="number" step="0.5" {...bind('expectedCtcLpa')} />}</Field>
        <Field label="Notice period (days)" error={errors.noticeDays}>{(p) => <input {...p} type="number" min="0" {...bind('noticeDays')} />}</Field>
        <Field label="Can work here legally?" error={errors.workAuth}>
          {(p) => (
            <Select {...p} {...bind('workAuth')}>
              <option value="">Not asked yet</option><option value="true">Yes</option><option value="false">No</option>
            </Select>
          )}
        </Field>
        <Field label="Available for the shift?" error={errors.shiftOk}>
          {(p) => (
            <Select {...p} {...bind('shiftOk')}>
              <option value="">Not asked yet</option><option value="true">Yes</option><option value="false">No</option>
            </Select>
          )}
        </Field>
        <Field label="Where they live" error={errors.location}>{(p) => <input {...p} {...bind('location')} />}</Field>
      </div>
    </Section>
  );
}

/* ---------- Interviews ---------- */

function Interviews({ c, rounds, me, canSchedule, canExit, onAction }) {
  if (c.stage === 'SCREENING' || !rounds.length) {
    return (
      <EmptyState title="Interviews have not started">
        {c.status === 'Shortlisted for interviews' ? 'Use the button at the top to start the rounds.' : 'Pass the phone screen first. Rounds are then set up from the role’s hiring plan.'}
      </EmptyState>
    );
  }
  return (
    <ol className="rounds-view">
      {rounds.map((r) => {
        const mine = r.panel?.find((p) => p.userId === me.id);
        const feedbackIn = r.panel?.filter((p) => p.submittedAt).length ?? 0;
        return (
          <li key={r.id} className={`round-view ${r.status === 'WAITING' ? 'muted-block' : ''}`}>
            <div className="round-view-head">
              <div>
                <strong>{r.position}. {r.name}</strong>
                <div className="muted small">{ROUND_TYPE_TEXT[r.type]}{r.who ? ` · ${r.who}` : ''}{r.format ? ` · ${r.format}` : ''}</div>
              </div>
              <Pill tone={ROUND_STATUS_TONE[r.status]}>{ROUND_STATUS_TEXT[r.status]}</Pill>
            </div>

            <div className="round-facts">
              {r.scheduledAt && (
                <span><strong>When:</strong> {fmtDateTime(r.scheduledAt, browserZone())}</span>
              )}
              {r.link && <span><strong>Link:</strong> <a href={r.link} target="_blank" rel="noreferrer">Open</a></span>}
              {r.testScore != null && <span><strong>Test score:</strong> {r.testScore}%{r.passPercent ? ` (pass at ${r.passPercent}%)` : ''}</span>}
              {r.reschedules > 0 && <span className="muted">Moved {r.reschedules} time{r.reschedules > 1 ? 's' : ''}</span>}
              {r.noShows > 0 && <span className="warn-text">No-shows: {r.noShows}</span>}
              {r.integrityFlag && <span className="warn-text">Integrity concern raised</span>}
            </div>

            {r.panel?.length > 0 && (
              <div className="panel-list">
                <span className="muted small">Panel, {feedbackIn} of {r.panel.length} feedback in:</span>
                <ul>
                  {r.panel.map((p) => (
                    <li key={p.id}>
                      {p.submittedAt ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                      <span>{p.name}{p.conflict ? ' (declared a conflict)' : ''}{p.avg != null ? ` · ${p.avg.toFixed(1)} of 5` : ''}{p.recommendation ? ` · ${p.recommendation === 'HIRE' ? 'Hire' : 'Do not hire'}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {r.resultNote && <p className="small muted">Decision note: {r.resultNote}</p>}

            <div className="round-actions">
              {canSchedule && ['TO_SCHEDULE', 'NO_SHOW'].includes(r.status) && (
                <Button onClick={() => onAction('schedule', r)}>{r.status === 'NO_SHOW' ? 'Rebook' : 'Schedule'}</Button>
              )}
              {canSchedule && r.status === 'SCHEDULED' && (
                <>
                  <Button onClick={() => onAction('schedule', r)}>Reschedule</Button>
                  <Button variant="ghost" onClick={() => onAction('noshow', r)}>Did not turn up</Button>
                  <Button variant="ghost" onClick={() => onAction('panel', r)}>Change interviewers</Button>
                  <a className="btn btn-ghost" href={`/api/rounds/${r.id}/invite.ics`}><Download size={16} aria-hidden="true" /> Calendar invite</a>
                </>
              )}
              {r.status === 'SCHEDULED' && mine && !mine.submittedAt && !mine.conflict && (
                <Button variant="primary" onClick={() => onAction('feedback', r)}>Add my feedback</Button>
              )}
              {r.status === 'SCHEDULED' && mine && !mine.submittedAt && !mine.conflict && (
                <Button variant="ghost" onClick={() => onAction('conflict', r)}>I know this candidate</Button>
              )}
              {r.status === 'SCHEDULED' && r.type === 'ONLINE_TEST' && hasPermission(me, 'candidate.write') && (
                <Button variant="primary" onClick={() => onAction('feedback', r)}>Enter test score</Button>
              )}
              {canExit && ['FAILED', 'DECISION_NEEDED'].includes(r.status) && <Button variant="primary" onClick={() => onAction('decide', r)}>Decide</Button>}
              {canExit && r.status === 'FAILED' && r.type === 'ONLINE_TEST' && !r.testReissued && (
                <Button onClick={() => onAction('reissue', r)}>Send the test again</Button>
              )}
              {canExit && r.status === 'HELD' && <Button variant="primary" onClick={() => onAction('resolvehold', r)}>Review the concern</Button>}
              {canExit && r.status === 'PENDING_FINAL' && <Button variant="primary" onClick={() => onAction('final', r)}>Final approval</Button>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Timeline ---------- */

function Timeline({ candidateId }) {
  const h = useHistory(candidateId);
  if (h.isPending) return <Skeleton rows={4} />;
  const events = h.data?.events ?? [];
  const audit = h.data?.audit ?? [];
  if (!events.length) return <EmptyState title="Nothing recorded yet" />;
  return (
    <div className="two-col">
      <Section id="events" title="What happened">
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id} className={`tl-item kind-${e.kind}`}>
              <div className="tl-main">{e.text}</div>
              <div className="tl-meta"><span className="muted small">{e.by_name ?? 'System'} · {fmtDateTime(e.at, browserZone())} · {fmtAgo(e.at)}</span></div>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="audit" title="Record of changes">
        <ol className="timeline">
          {audit.map((a) => (
            <li key={a.id} className="tl-item">
              <div className="tl-main">{a.action.replace(/_/g, ' ')}{a.reason ? `: ${a.reason}` : ''}</div>
              <div className="tl-meta"><span className="muted small">{a.by_name ?? 'System'} · {fmtDateTime(a.at, browserZone())}</span></div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export { fmtDate };

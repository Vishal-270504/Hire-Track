import { useState } from 'react';
import { toast } from 'sonner';
import { post, put, ApiError } from '../../lib/api.js';
import { REFRESH_ALL_CANDIDATE, useCommand, usePeople, useRequisitions } from '../../lib/data.js';
import { browserZone, fmtDateTime, REJECT_REASONS, ROUND_TYPE_TEXT } from '../../lib/format.js';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Field } from '../../components/ui.jsx';
import { hasPermission } from '../../lib/auth.js';
import { useSuggest } from '../../lib/data.js';
import { Select } from '../../components/Select.jsx';

/**
 * One dialog shell for every action on a candidate. It shows the server's message next to the
 * right field, disables the button while saving, and refreshes the screens when it succeeds.
 */
export function ActionDialog({ open, title, submitLabel = 'Save', tone = 'primary', onClose, run, onDone, children, hideSubmit }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const submit = async () => {
    setBusy(true); setErrors({}); setMessage('');
    try {
      const result = await run();
      REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      onDone?.(result);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setMessage(e.message);
      } else setMessage('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          {!hideSubmit && <Button variant={tone} disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</Button>}
        </>
      }
    >
      {typeof children === 'function' ? children({ errors }) : children}
      {message && <p role="alert" className="banner bad mt">{message}</p>}
    </Dialog>
  );
}

export function PhoneScreenDialog({ open, onClose, candidate }) {
  const [outcome, setOutcome] = useState('PASS');
  const [notes, setNotes] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="HR phone screen" submitLabel="Save the call"
      run={() => post(`/api/candidates/${candidate.id}/phone-screen`, { outcome, notes })}>
      {({ errors }) => (
        <div className="stack">
          <fieldset className="radio-group">
            <legend>How did it go?</legend>
            <label className="radio"><input type="radio" name="outcome" checked={outcome === 'PASS'} onChange={() => setOutcome('PASS')} /> Good to move on to interviews</label>
            <label className="radio"><input type="radio" name="outcome" checked={outcome === 'FAIL'} onChange={() => setOutcome('FAIL')} /> Not a fit right now</label>
          </fieldset>
          <Field label="Notes from the call" error={errors.notes} hint="Interest, communication, reason for moving, notice period.">
            {(p) => <textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function NoticeApprovalDialog({ open, onClose, candidate }) {
  return (
    <ActionDialog open={open} onClose={onClose} title="Approve the long notice period?" submitLabel="Approve" tone="primary"
      run={() => post(`/api/candidates/${candidate.id}/notice-approval`, {})}>
      <p>The notice period is longer than the role allows. Approving records that you have checked this with the hiring manager, and lets the process go on.</p>
    </ActionDialog>
  );
}

/** Reject: plain reasons, an optional note, and a draft email. The undo window is shown after. */
export function RejectDialog({ open, onClose, candidate, onRejected }) {
  const [choice, setChoice] = useState(REJECT_REASONS[0]);
  const [extra, setExtra] = useState('');
  const reasonText = choice === 'Other (explain below)' ? extra.trim() : [choice, extra.trim()].filter(Boolean).join(' - ');
  return (
    <ActionDialog open={open} onClose={onClose} title={`Reject ${candidate.name}?`} submitLabel="Reject" tone="danger"
      run={() => post(`/api/candidates/${candidate.id}/reject`, { reason: reasonText })}
      onDone={(res) => onRejected?.(res)}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">They will leave the active lists. You can undo this for 10 minutes. A draft email is prepared for you to send.</p>
          <Field label="Reason" error={errors.reason}>
            {(p) => (
              <Select {...p} value={choice} onChange={(e) => setChoice(e.target.value)}>
                {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
              </Select>
            )}
          </Field>
          <Field label={choice === 'Other (explain below)' ? 'Explain (required)' : 'Anything to add (optional)'}>
            {(p) => <input {...p} value={extra} onChange={(e) => setExtra(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function RejectionDraftDialog({ open, onClose, draft }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={open} title="Rejection email, ready to send" onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={async () => {
        try { await navigator.clipboard.writeText(draft); setCopied(true); toast.success('Copied.'); } catch { toast.error('Could not copy. Select the text and copy it.'); }
      }}>{copied ? 'Copied' : 'Copy email'}</Button></>}>
      <pre className="pre">{draft}</pre>
    </Dialog>
  );
}

export function WithdrawDialog({ open, onClose, candidate }) {
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title={`${candidate.name} withdrew?`} submitLabel="Mark as withdrawn" tone="danger"
      run={() => post(`/api/candidates/${candidate.id}/withdraw`, { reason })}>
      {({ errors }) => (
        <Field label="Why they withdrew" error={errors.reason} hint="For example: accepted another offer.">
          {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
    </ActionDialog>
  );
}

export function TalentPoolDialog({ open, onClose, candidate }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Keep in the talent pool" submitLabel="Keep in pool"
      run={() => post(`/api/candidates/${candidate.id}/talent-pool`, { followUpDate: date, reason })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Not right for this role, but worth keeping. We will remind you to check back.</p>
          <Field label="Check back on" error={errors.followUpDate} hint="Between 30 days and 6 months from today.">
            {(p) => <input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Note (optional)">
            {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function HoldDialog({ open, onClose, candidate }) {
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Put on hold" submitLabel="Put on hold"
      run={() => post(`/api/candidates/${candidate.id}/hold`, { reason })}>
      {({ errors }) => (
        <Field label="Why?" error={errors.reason}>
          {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
    </ActionDialog>
  );
}

export function MoveJobDialog({ open, onClose, candidate }) {
  const roles = useRequisitions('OPEN');
  const [requisitionId, setRequisitionId] = useState('');
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Move to another role" submitLabel="Move"
      run={() => post(`/api/candidates/${candidate.id}/move-job`, { requisitionId: Number(requisitionId), reason })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Their feedback stays with them. Interview rounds are set up again for the new role.</p>
          <Field label="Role" error={errors.requisitionId}>
            {(p) => (
              <Select {...p} value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)}>
                <option value="">Choose an open role</option>
                {(roles.data ?? []).filter((r) => r.id !== candidate.requisitionId).map((r) => <option key={r.id} value={r.id}>{r.title}{r.level ? ` · ${r.level}` : ''}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Why?" error={errors.reason} hint="For example: stronger fit for the senior role.">
            {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function AssignDialog({ open, onClose, candidate }) {
  const people = usePeople();
  const [ownerId, setOwnerId] = useState(candidate.ownerId ? String(candidate.ownerId) : '');
  const choices = (people.data?.people ?? []).filter((p) => ['HR', 'RECRUITER', 'ADMIN'].includes(p.role));
  return (
    <ActionDialog open={open} onClose={onClose} title="Who owns this candidate?" submitLabel="Assign"
      run={() => post(`/api/candidates/${candidate.id}/assign`, { ownerId: Number(ownerId) })}>
      {({ errors }) => (
        <Field label="Recruiter" error={errors.ownerId}>
          {(p) => (
            <Select {...p} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Choose a person</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
      )}
    </ActionDialog>
  );
}

export function NoteDialog({ open, onClose, candidate }) {
  const [text, setText] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Add a note" submitLabel="Add note"
      run={() => post(`/api/candidates/${candidate.id}/notes`, { text })}>
      {({ errors }) => (
        <Field label="Note" error={errors.text} hint="Type @ and a colleague's first name to send them a reminder about it.">
          {(p) => <textarea {...p} rows={4} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      )}
    </ActionDialog>
  );
}

/* ---------- interview rounds ---------- */

const defaultWhen = () => {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ScheduleDialog({ open, onClose, round, me }) {
  const people = usePeople();
  const [when, setWhen] = useState(defaultWhen);
  const [link, setLink] = useState(round?.link ?? '');
  const [panel, setPanel] = useState([]);
  const [approve, setApprove] = useState(false);
  const isTest = round?.type === 'ONLINE_TEST';
  const canApprove = ['HR', 'ADMIN'].includes(me?.role);
  const reschedule = round?.status === 'SCHEDULED';
  const choices = (people.data?.people ?? []).filter((p) => ['INTERVIEWER', 'HR', 'ADMIN'].includes(p.role));
  const suggest = useSuggest(round?.id, open && !isTest);
  const free = suggest.data?.suggestions ?? [];
  return (
    <ActionDialog open={open} onClose={onClose}
      title={`${reschedule ? 'Reschedule' : round?.status === 'NO_SHOW' ? 'Rebook' : 'Schedule'} ${round?.name ?? ''}`}
      submitLabel={reschedule ? 'Move the interview' : 'Book it'}
      run={() => post(`/api/rounds/${round.id}/schedule`, {
        when: new Date(when).toISOString(), timeZone: browserZone(), link,
        panelIds: isTest ? [] : panel, approveExtraReschedule: approve,
      })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">{ROUND_TYPE_TEXT[round?.type]}. Times are shown in your time zone ({browserZone()}).</p>
          <Field label="Date and time" error={errors.when}>
            {(p) => <input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
          </Field>
          <Field label={isTest ? 'Test link' : 'Meeting link'} error={errors.link} hint={isTest ? 'The candidate uses this to start the test.' : 'Video call link, if any.'}>
            {(p) => <input {...p} type="url" value={link} onChange={(e) => setLink(e.target.value)} />}
          </Field>
          {!isTest && (
            <fieldset className="radio-group">
              <legend>Interviewers{errors.panelIds && <span className="bad"> — {errors.panelIds}</span>}</legend>
              {choices.length === 0 && <p className="muted small">No interviewers yet. Add one under Team first.</p>}
              {free.length > 0 && (
                <p className="small muted">Free at this time: {free.slice(0, 6).map((p) => (
                  <button key={p.id} type="button" className="chip-btn" onClick={() => setPanel((s) => (s.includes(p.id) ? s : [...s, p.id]))}>{p.name}</button>
                ))}</p>
              )}
              {choices.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={panel.includes(p.id)} onChange={(e) => setPanel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                  {p.name}
                </label>
              ))}
            </fieldset>
          )}
          {reschedule && canApprove && (
            <label className="check">
              <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
              Approve this extra change (the limit has been reached)
            </label>
          )}
          {errors.approveExtraReschedule && <p className="field-msg bad">{errors.approveExtraReschedule}</p>}
        </div>
      )}
    </ActionDialog>
  );
}

export function NoShowDialog({ open, onClose, round, me }) {
  const [confirmReject, setConfirmReject] = useState(false);
  const second = round?.noShows >= 1;
  return (
    <ActionDialog open={open} onClose={onClose} title={`${round?.name}: candidate did not turn up`} submitLabel="Record no-show" tone="danger"
      run={() => post(`/api/rounds/${round.id}/no-show`, { confirmReject })}>
      {({ errors }) => (
        <div className="stack">
          <p>{second ? 'This is the second no-show. HR decides whether the process ends here.' : 'We will offer one rebook link. A second no-show ends the process after HR confirms.'}</p>
          {(second || errors.confirmReject) && (
            <label className="check">
              <input type="checkbox" checked={confirmReject} onChange={(e) => setConfirmReject(e.target.checked)} />
              Yes, reject them now for not attending
            </label>
          )}
          {errors.confirmReject && <p className="field-msg bad">{errors.confirmReject}</p>}
          {me?.role === 'INTERVIEWER' && <p className="muted small">Only HR can confirm a rejection.</p>}
        </div>
      )}
    </ActionDialog>
  );
}

export function FeedbackDialog({ open, onClose, round, me }) {
  const isTest = round?.type === 'ONLINE_TEST';
  const isDecision = round?.type === 'DECISION';
  const staff = hasPermission(me, 'candidate.write');
  const skills = round?.skills?.length ? round.skills : ['Overall'];
  const [scores, setScores] = useState({});
  const [recommendation, setRecommendation] = useState('');
  const [testScore, setTestScore] = useState('');
  const [comments, setComments] = useState('');
  const [integrity, setIntegrity] = useState(false);
  return (
    <ActionDialog open={open} onClose={onClose} title={isTest ? `Test score: ${round?.name}` : `Feedback: ${round?.name}`} submitLabel="Submit feedback"
      run={() => post(`/api/rounds/${round.id}/feedback`, isTest
        ? { testScore: Number(testScore), comments: comments || undefined, integrityFlag: integrity }
        : {
          scores: isDecision ? undefined : Object.fromEntries(skills.map((s) => [s, Number(scores[s])])),
          recommendation: isDecision ? recommendation : undefined,
          comments, integrityFlag: integrity,
        })}>
      {({ errors }) => (
        <div className="stack">
          {isTest && (
            <Field label="Score (%)" error={errors.testScore} hint="From the test platform report.">
              {(p) => <input {...p} type="number" min="0" max="100" value={testScore} onChange={(e) => setTestScore(e.target.value)} />}
            </Field>
          )}
          {!isTest && !isDecision && skills.map((s) => (
            <Field key={s} label={`${s} (1 to 5)`} error={errors.scores}>
              {(p) => (
                <Select {...p} value={scores[s] ?? ''} onChange={(e) => setScores((x) => ({ ...x, [s]: e.target.value }))}>
                  <option value="">Choose</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              )}
            </Field>
          ))}
          {isDecision && (
            <fieldset className="radio-group">
              <legend>Your recommendation</legend>
              <label className="radio"><input type="radio" name="rec" checked={recommendation === 'HIRE'} onChange={() => setRecommendation('HIRE')} /> Hire</label>
              <label className="radio"><input type="radio" name="rec" checked={recommendation === 'NO_HIRE'} onChange={() => setRecommendation('NO_HIRE')} /> Do not hire</label>
              {errors.recommendation && <p className="field-msg bad">{errors.recommendation}</p>}
            </fieldset>
          )}
          {!isTest && (
            <Field label="What did you see?" error={errors.comments} hint="A few honest sentences. HR reads this before any decision.">
              {(p) => <textarea {...p} rows={4} value={comments} onChange={(e) => setComments(e.target.value)} />}
            </Field>
          )}
          {(staff || !isTest) && (
            <label className="check">
              <input type="checkbox" checked={integrity} onChange={(e) => setIntegrity(e.target.checked)} />
              I have a concern about cheating or integrity. Hold the result for HR.
            </label>
          )}
        </div>
      )}
    </ActionDialog>
  );
}

export function ConflictDialog({ open, onClose, round }) {
  const [note, setNote] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="I know this candidate" submitLabel="Declare conflict"
      run={() => post(`/api/rounds/${round.id}/conflict`, { note })}>
      <Field label="How do you know them? (optional)">
        {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <p className="muted small mt">HR will pick another interviewer.</p>
    </ActionDialog>
  );
}

export function PanelDialog({ open, onClose, round }) {
  const people = usePeople();
  const [ids, setIds] = useState(() => round?.panel?.map((p) => p.userId) ?? []);
  const choices = (people.data?.people ?? []).filter((p) => ['INTERVIEWER', 'HR', 'ADMIN'].includes(p.role));
  return (
    <ActionDialog open={open} onClose={onClose} title={`Change the interviewers for ${round?.name}`} submitLabel="Save panel"
      run={() => put(`/api/rounds/${round.id}/panel`, { userIds: ids })}>
      {({ errors }) => (
        <fieldset className="radio-group">
          <legend>Interviewers{errors.userIds && <span className="bad"> — {errors.userIds}</span>}</legend>
          {choices.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
    </ActionDialog>
  );
}

export function DecideRoundDialog({ open, onClose, round }) {
  const [outcome, setOutcome] = useState('PASS');
  const [note, setNote] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title={`Decide: ${round?.name}`} submitLabel="Record decision"
      run={() => post(`/api/rounds/${round.id}/resolve`, { outcome, note })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">The panel {round?.status === 'DECISION_NEEDED' ? 'disagrees' : 'did not pass them'}. Read the feedback, then decide.</p>
          <fieldset className="radio-group">
            <legend>Decision</legend>
            <label className="radio"><input type="radio" name="o" checked={outcome === 'PASS'} onChange={() => setOutcome('PASS')} /> Move them to the next round</label>
            <label className="radio"><input type="radio" name="o" checked={outcome === 'FAIL'} onChange={() => setOutcome('FAIL')} /> Reject them</label>
          </fieldset>
          <Field label="Why? (required)" error={errors.note}>
            {(p) => <textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function ResolveHoldDialog({ open, onClose, round }) {
  const [decision, setDecision] = useState('CONTINUE');
  const [note, setNote] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title={`Review: ${round?.name}`} submitLabel="Record review"
      run={() => post(`/api/rounds/${round.id}/resolve-hold`, { decision, note })}>
      {({ errors }) => (
        <div className="stack">
          <fieldset className="radio-group">
            <legend>After review</legend>
            <label className="radio"><input type="radio" name="d" checked={decision === 'CONTINUE'} onChange={() => setDecision('CONTINUE')} /> The concern is cleared. Continue.</label>
            <label className="radio"><input type="radio" name="d" checked={decision === 'REJECT'} onChange={() => setDecision('REJECT')} /> Reject them</label>
          </fieldset>
          <Field label="What did you find?" error={errors.note}>
            {(p) => <textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export function ReissueDialog({ open, onClose, round }) {
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Send the test again?" submitLabel="Send again"
      run={() => post(`/api/rounds/${round.id}/reissue-test`, { reason })}>
      {({ errors }) => (
        <Field label="Why?" error={errors.reason} hint="For example: test link expired, or a technical problem.">
          {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
    </ActionDialog>
  );
}

export function FinalDialog({ open, onClose, round }) {
  const [decision, setDecision] = useState('APPROVE');
  const [comment, setComment] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Final approval" submitLabel="Record decision"
      run={() => post(`/api/rounds/${round.id}/final`, { decision, comment })}>
      {({ errors }) => (
        <div className="stack">
          <fieldset className="radio-group">
            <legend>Decision</legend>
            <label className="radio"><input type="radio" name="f" checked={decision === 'APPROVE'} onChange={() => setDecision('APPROVE')} /> Approve for an offer</label>
            <label className="radio"><input type="radio" name="f" checked={decision === 'REJECT'} onChange={() => setDecision('REJECT')} /> Do not proceed</label>
          </fieldset>
          <Field label={decision === 'REJECT' ? 'Why? (required)' : 'Note (optional)'} error={errors.comment}>
            {(p) => <textarea {...p} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

export { useCommand, fmtDateTime };

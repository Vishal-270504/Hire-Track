import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { post, put, ApiError } from '../../lib/api.js';
import { useJoining, REFRESH_ALL_CANDIDATE, useCommand } from '../../lib/data.js';
import { useMe, hasPermission } from '../../lib/auth.js';
import { fmtDate, fmtDateTime, browserZone } from '../../lib/format.js';
import { Button, Field, Pill, EmptyState, Skeleton, Dialog } from '../../components/ui.jsx';
import { Section } from '../../components/kit.jsx';
import { ActionDialog } from './dialogs.jsx';
import { Select } from '../../components/Select.jsx';

const DOC_TONE = { PENDING: 'neutral', SUBMITTED: 'accent', VERIFIED: 'ok', REJECTED: 'bad', LATER: 'warn', AFFIDAVIT: 'info' };
const DOC_TEXT = { PENDING: 'Not received', SUBMITTED: 'Received, to check', VERIFIED: 'Checked', REJECTED: 'Needs replacing', LATER: 'To follow', AFFIDAVIT: 'Affidavit or gazette notice' };
const BGV_TONE = { PENDING: 'neutral', IN_PROGRESS: 'accent', CLEAR: 'ok', FLAGGED: 'bad' };
const BGV_TEXT = { PENDING: 'Not started', IN_PROGRESS: 'In progress', CLEAR: 'Clear', FLAGGED: 'Flagged' };

/** Pre-joining: documents, background checks, prep tasks, check-ins, and the Day 1 actions. */
export default function JoiningPanel({ c }) {
  const me = useMe();
  const j = useJoining(c.id);
  const [dialog, setDialog] = useState(null);
  const manage = hasPermission(me.data, 'joining.manage');
  if (j.isPending) return <Skeleton rows={5} />;
  if (j.error) return <div role="alert" className="banner bad">{j.error.message}</div>;
  const d = j.data;
  const inPre = c.phase === 'PRE_JOINING';
  const docsOutstanding = (d.documents ?? []).filter((x) => !['VERIFIED', 'LATER', 'AFFIDAVIT'].includes(x.status)).length;
  const bgvFlagged = (d.bgv ?? []).some((b) => b.status === 'FLAGGED');
  const bgvDone = (d.bgv ?? []).length > 0 && (d.bgv ?? []).every((b) => b.status === 'CLEAR');

  return (
    <div className="stack-lg">
      <Section id="join-summary" title="Joining" action={inPre && manage && (
        <div className="round-actions">
          <Button variant="primary" onClick={() => setDialog('join')}>Day 1: join</Button>
          <Button onClick={() => setDialog('date')}>Change the joining date</Button>
          <Button variant="ghost" onClick={() => setDialog('noshow')}>No-show on Day 1</Button>
        </div>
      )}>
        <dl className="facts">
          <div className="fact"><dt>Joining date</dt><dd>{fmtDate(d.joinDate)}{d.joinDateChanges ? ` (changed ${d.joinDateChanges}×)` : ''}</dd></div>
          <div className="fact"><dt>Documents</dt><dd>{docsOutstanding ? `${docsOutstanding} still to check` : d.documents ? 'All checked or accounted for' : 'Visible to HR'}</dd></div>
          <div className="fact"><dt>Background checks</dt><dd>{bgvFlagged ? 'Flagged, HR head to decide' : bgvDone ? 'All clear' : 'In progress'}</dd></div>
          <div className="fact"><dt>Relieving letter</dt><dd>{d.relievingStatus === 'LATER' ? `To follow by ${fmtDate(d.relievingDue)}` : d.relievingStatus === 'RECEIVED' ? 'Received' : 'Not needed or not yet asked'}</dd></div>
        </dl>
        {d.subjectToBgv && <p className="banner accent mt">Joined subject to background check. Production access stays restricted until all checks clear.</p>}
        <PeopleForm c={c} buddy={d.buddy} manager={d.manager} canEdit={hasPermission(me.data, 'joining.view')} />
        {manage && (
          <div className="round-actions mt">
            <Button variant="ghost" onClick={() => setDialog('relieving')}>Relieving letter</Button>
          </div>
        )}
      </Section>

      {d.documents && (
        <Section id="docs" title={`Documents · ${d.documents.length}`}>
          <p className="muted small">The candidate uploads these through their status page, or HR can upload them here. Check each one before joining.</p>
          <ul className="doc-list">
            {d.documents.map((doc) => <DocRow key={doc.id} doc={doc} c={c} manage={manage} />)}
          </ul>
        </Section>
      )}

      {d.bgv && (
        <Section id="bgv" title="Background checks" action={bgvFlagged && <Pill tone="bad">Flagged</Pill>}>
          <ul className="doc-list">
            {d.bgv.map((b) => <BgvRow key={b.id} b={b} c={c} manage={manage} />)}
          </ul>
        </Section>
      )}

      <Section id="tasks" title={`Prep tasks · ${d.tasks.filter((t) => t.status === 'OPEN').length} open`}>
        {d.tasks.length === 0 ? <EmptyState title="No prep tasks yet">Tasks appear once the offer is accepted.</EmptyState> : (
          <ul className="doc-list">
            {d.tasks.map((t) => <TaskRow key={t.id} t={t} c={c} />)}
          </ul>
        )}
      </Section>

      <Section id="checkins" title="Notice-period check-ins">
        <CheckinForm c={c} />
        {d.checkins.length > 0 && (
          <ol className="timeline">
            {d.checkins.map((k) => (
              <li key={k.id} className="tl-item">
                <div className="tl-main">{k.note}</div>
                <div className="tl-meta"><span className="muted small">{k.by ?? 'System'} · {fmtDateTime(k.at, browserZone())}</span></div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <JoinDialog open={dialog === 'join'} onClose={() => setDialog(null)} c={c} d={d} />
      <DateDialog open={dialog === 'date'} onClose={() => setDialog(null)} c={c} d={d} />
      <NoShowDialog open={dialog === 'noshow'} onClose={() => setDialog(null)} c={c} />
      <RelievingDialog open={dialog === 'relieving'} onClose={() => setDialog(null)} c={c} />
    </div>
  );
}

function PeopleForm({ c, buddy, manager, canEdit }) {
  const [b, setB] = useState(buddy ?? '');
  const [m, setM] = useState(manager ?? '');
  const save = useCommand(() => post(`/api/candidates/${c.id}/people`, { buddy: b, manager: m }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Buddy and manager saved.' });
  if (!canEdit) return null;
  return (
    <div className="form-grid mt">
      <Field label="Buddy (who helps them settle in)">{(p) => <input {...p} value={b} onChange={(e) => setB(e.target.value)} />}</Field>
      <Field label="Reporting manager">{(p) => <input {...p} value={m} onChange={(e) => setM(e.target.value)} />}</Field>
      <div className="align-end"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
    </div>
  );
}

function DocRow({ doc, c, manage }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const review = async (status, extra = {}) => {
    setBusy(true);
    try {
      await post(`/api/documents/${doc.id}/review`, { status, ...extra });
      refresh();
      toast.success(`${doc.docType}: ${DOC_TEXT[status].toLowerCase()}.`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${c.id}/documents/${doc.id}/upload`, { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data);
      refresh();
      toast.success('File uploaded.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <li className="doc-row">
      <div className="doc-main">
        <strong>{doc.docType}</strong>
        <Pill tone={DOC_TONE[doc.status]}>{DOC_TEXT[doc.status]}</Pill>
        {doc.hasFile && <a href={`/api/documents/${doc.id}/file`} className="small">Open file ({doc.filename})</a>}
      </div>
      {doc.reason && <p className="small bad-text">Reason: {doc.reason}</p>}
      {doc.note && <p className="small muted">{doc.note}</p>}
      {manage && (
        <div className="round-actions">
          <label className="btn btn-ghost upload-btn">
            Upload file
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {doc.status === 'SUBMITTED' && <Button variant="primary" disabled={busy} onClick={() => review('VERIFIED')}>Mark checked</Button>}
          {doc.status !== 'VERIFIED' && (
            <>
              <input aria-label={`Note for ${doc.docType}`} placeholder="Reason or note" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={busy || note.trim().length < 3} onClick={() => review('REJECTED', { reason: note })}>Needs replacing</Button>
              <Button disabled={busy || note.trim().length < 3} onClick={() => review('AFFIDAVIT', { note })}>Affidavit</Button>
              <Button disabled={busy || note.trim().length < 3} onClick={() => review('LATER', { note })}>To follow</Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function BgvRow({ b, c, manage }) {
  const [status, setStatus] = useState(b.status);
  const [note, setNote] = useState(b.note ?? '');
  const save = useCommand(() => put(`/api/candidates/${c.id}/bgv`, { checkType: b.checkType, status, note }), { refresh: REFRESH_ALL_CANDIDATE, success: `${b.checkType} saved.` });
  return (
    <li className="doc-row">
      <div className="doc-main">
        <strong>{b.checkType}</strong>
        <Pill tone={BGV_TONE[b.status]}>{BGV_TEXT[b.status]}</Pill>
      </div>
      {b.note && <p className="small muted">{b.note}</p>}
      {manage && (
        <div className="round-actions">
          <Select aria-label={`Status of ${b.checkType}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="CLEAR">Clear</option>
            <option value="FLAGGED">Flagged</option>
          </Select>
          {status === 'FLAGGED' && <input aria-label="What was found" placeholder="What was found" value={note} onChange={(e) => setNote(e.target.value)} />}
          <Button disabled={save.isPending || (status === b.status && note === (b.note ?? ''))} onClick={() => save.mutate()}>Save</Button>
        </div>
      )}
    </li>
  );
}

function TaskRow({ t, c }) {
  const done = useCommand(() => post(`/api/tasks/${t.id}/done`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Task done.' });
  const overdue = t.status === 'OPEN' && t.dueOn < new Date().toISOString().slice(0, 10);
  return (
    <li className="doc-row">
      <div className="doc-main">
        <span className={t.status === 'DONE' ? 'muted strike' : ''}>{t.title}</span>
        <Pill tone={t.ownerTeam === 'HR' ? 'accent' : t.ownerTeam === 'IT' ? 'info' : 'neutral'}>{t.ownerTeam}</Pill>
        {t.status === 'OPEN' && <span className={`small ${overdue ? 'bad-text' : 'muted'}`}>Due {fmtDate(t.dueOn)}{overdue ? ' (overdue)' : ''}</span>}
        {t.status === 'DONE' && <span className="small muted">Done</span>}
        {t.status === 'CANCELLED' && <span className="small muted">Cancelled</span>}
      </div>
      {t.status === 'OPEN' && (
        <div className="round-actions">
          <Button variant="secondary" disabled={done.isPending} onClick={() => done.mutate()}>Mark done</Button>
        </div>
      )}
    </li>
  );
}

function CheckinForm({ c }) {
  const [note, setNote] = useState('');
  const add = useCommand(() => post(`/api/candidates/${c.id}/checkins`, { note }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Check-in saved.' });
  return (
    <div className="round-actions">
      <input aria-label="Check-in note" placeholder="How did the check-in go?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
      <Button disabled={note.trim().length < 3 || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setNote('') })}>Save check-in</Button>
    </div>
  );
}

function JoinDialog({ open, onClose, c, d }) {
  const [subjectToBgv, setSubject] = useState(false);
  const [relievingLater, setRelieving] = useState(false);
  return (
    <ActionDialog open={open} onClose={onClose} title={`Day 1: ${c.name} joins`} submitLabel="Record joining"
      run={() => post(`/api/candidates/${c.id}/join`, { subjectToBgv, relievingLater })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">This creates the employee record, the employee code and company email, and the Day 1 checklist. Probation starts once all access is live.</p>
          {errors.joinDate && <p className="field-msg bad">{errors.joinDate}</p>}
          <label className="check"><input type="checkbox" checked={subjectToBgv} onChange={(e) => setSubject(e.target.checked)} /> Join subject to background checks (access restricted until clear)</label>
          <label className="check"><input type="checkbox" checked={relievingLater} onChange={(e) => setRelieving(e.target.checked)} /> Relieving letter to follow (HR is reminded in 30 days)</label>
          {d.bgv && !d.bgv.every((b) => b.status === 'CLEAR') && <p className="small bad-text">Background checks are not all clear yet. Tick the first box to go ahead.</p>}
        </div>
      )}
    </ActionDialog>
  );
}

function DateDialog({ open, onClose, c, d }) {
  const [joinDate, setJoinDate] = useState(d.joinDate ?? '');
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Change the joining date" submitLabel="Change date"
      run={() => post(`/api/candidates/${c.id}/join-date`, { joinDate, reason })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Allowed once. Prep tasks move by the same number of days.</p>
          <Field label="New joining date" error={errors.joinDate}>{(p) => <input {...p} type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />}</Field>
          <Field label="Why?" error={errors.reason}>{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      )}
    </ActionDialog>
  );
}

function NoShowDialog({ open, onClose, c }) {
  const [reason, setReason] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="No-show on Day 1?" submitLabel="Record no-show" tone="danger"
      run={() => post(`/api/candidates/${c.id}/day-one-no-show`, { reason })}>
      <p className="small">Email and access requests are cancelled and the offer is closed. Their role can then be offered to a runner-up.</p>
      <Field label="Note (optional)">{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </ActionDialog>
  );
}

function RelievingDialog({ open, onClose, c }) {
  const received = useCommand(() => post(`/api/candidates/${c.id}/relieving`, { status: 'RECEIVED' }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Relieving letter marked received.' });
  const later = useCommand(() => post(`/api/candidates/${c.id}/relieving`, { status: 'LATER' }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Reminder set for 30 days.' });
  return (
    <Dialog open={open} title="Relieving letter" onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button onClick={() => later.mutate(undefined, { onSuccess: onClose })}>It will follow</Button><Button variant="primary" onClick={() => received.mutate(undefined, { onSuccess: onClose })}>Received</Button></>}>
      <p>If they are still serving notice, it can follow. HR is reminded on Today before the due date.</p>
    </Dialog>
  );
}

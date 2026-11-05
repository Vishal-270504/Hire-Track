import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { post, del, ApiError } from '../../lib/api.js';
import { useRequisition, useReqHistory, useCommand, REFRESH_REQUISITION } from '../../lib/data.js';
import { REQ_STATUS_TEXT, REQ_STATUS_TONE, fmtDate, fmtDateTime, lpa, browserZone } from '../../lib/format.js';
import { Button, Dialog, Pill, PageHeader, Field, EmptyState, Skeleton } from '../../components/ui.jsx';
import { TabBar, TabPanel, ActionMenu, Facts, Section } from '../../components/kit.jsx';
import { useMe, hasPermission } from '../../lib/auth.js';
import RoundsEditor from './RoundsEditor.jsx';
import ApproverPicker, { defaultSteps } from './ApproverPicker.jsx';

export default function RequisitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reqId = Number(id);
  const me = useMe();
  const { data, isPending, error, refetch } = useRequisition(reqId);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null); // 'send' | 'approve' | 'reject' | 'hold' | 'close' | 'reopen' | 'delete'

  if (isPending) return <Skeleton rows={5} />;
  if (error) return <div role="alert" className="banner bad">{error.message} <Button onClick={() => refetch()}>Try again</Button></div>;
  const req = data.requisition;
  const canWrite = hasPermission(me.data, 'requisition.write');
  const myStep = req.approvals.find((a) => a.status === 'PENDING' && a.approverId === me.data?.id);
  const isAdmin = me.data?.role === 'ADMIN';
  const waitingStep = req.approvals.find((a) => a.status === 'PENDING');

  return (
    <>
      <PageHeader
        title={req.title}
        lead={[req.level, req.team, req.remote ? 'Remote allowed' : req.location].filter(Boolean).join(' · ')}
        actions={
          <div className="page-actions">
            <Pill tone={REQ_STATUS_TONE[req.status]}>{REQ_STATUS_TEXT[req.status]}</Pill>
            {canWrite && ['DRAFT', 'REJECTED'].includes(req.status) && (
              <Button variant="primary" onClick={() => setDialog('send')}><Send size={16} aria-hidden="true" /> {req.status === 'DRAFT' ? 'Send for approval' : 'Send again'}</Button>
            )}
            {canWrite && ['DRAFT', 'REJECTED'].includes(req.status) && (
              <Button onClick={() => navigate(`/requisitions/${req.id}/edit`)}><Pencil size={16} aria-hidden="true" /> Edit details</Button>
            )}
            {myStep && (
              <>
                <Button variant="primary" onClick={() => setDialog('approve')}>Approve</Button>
                <Button variant="danger" onClick={() => setDialog('reject')}>Not approve</Button>
              </>
            )}
            {canWrite && req.status === 'OPEN' && <PublishButton req={req} />}
            {canWrite && req.status === 'OPEN' && <Button onClick={() => setDialog('hold')}>Put on hold</Button>}
            {canWrite && req.status === 'ON_HOLD' && <Button variant="primary" onClick={() => setDialog('reopen')}>Reopen</Button>}
            {canWrite && ['OPEN', 'ON_HOLD'].includes(req.status) && <Button onClick={() => setDialog('close')}>Close role</Button>}
            {canWrite && (
              <ActionMenu items={[
                req.status === 'DRAFT' && { label: 'Delete draft', icon: Trash2, tone: 'danger', onSelect: () => setDialog('delete') },
              ]} />
            )}
          </div>
        }
      />

      {req.status === 'REJECTED' && req.statusReason && (
        <p role="status" className="banner bad">Not approved: {req.statusReason}</p>
      )}
      {req.status === 'ON_HOLD' && req.statusReason && <p role="status" className="banner accent">On hold: {req.statusReason}</p>}
      {req.status === 'PENDING_APPROVAL' && waitingStep && (
        <p role="status" className="banner accent">
          Waiting for <strong>{waitingStep.label}</strong> ({waitingStep.approverName}).
        </p>
      )}

      <TabBar
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'overview', label: 'Details' },
          { value: 'plan', label: 'Hiring plan', count: req.rounds.length },
          { value: 'approvals', label: 'Approvals', count: req.approvals.length || undefined },
          { value: 'history', label: 'History' },
        ]}
      >
        <TabPanel value="overview" className="tab-body">
          <Section id="facts" title="The role">
            <Facts items={[
              { label: 'Headcount', value: req.headcount },
              { label: 'Most we can pay', value: lpa(req.budgetMaxLpa) },
              { label: 'Target joining', value: fmtDate(req.targetJoinDate) },
              { label: 'Experience', value: req.expMin != null || req.expMax != null ? `${req.expMin ?? 0} to ${req.expMax ?? '—'} years` : null },
              { label: 'Longest notice accepted', value: req.noticeMaxDays != null ? `${req.noticeMaxDays} days` : null },
              { label: 'Last changed', value: fmtDateTime(req.updatedAt, browserZone()) },
            ]} />
          </Section>
          <Section id="skills" title="Skills">
            <p><strong>Must have:</strong> {req.mustSkills.join(', ') || <span className="muted">Not set</span>}</p>
            <p className="mt"><strong>Good to have:</strong> {req.goodSkills.join(', ') || <span className="muted">None</span>}</p>
          </Section>
          {req.jdText && (
            <Section id="jd" title="Job description">
              <p className="pre">{req.jdText}</p>
            </Section>
          )}
        </TabPanel>

        <TabPanel value="plan" className="tab-body">
          <RoundsEditor
            requisition={req}
            editable={canWrite && req.status !== 'CLOSED'}
            onSaved={() => {}}
          />
        </TabPanel>

        <TabPanel value="approvals" className="tab-body">
          {req.approvals.length === 0 ? (
            <EmptyState title="Not sent for approval yet">Send the role for approval once the details and hiring plan are ready.</EmptyState>
          ) : (
            <ol className="timeline">
              {req.approvals.map((a) => (
                <li key={a.id} className={`tl-item ${a.status.toLowerCase()}`}>
                  <div className="tl-main">
                    <strong>{a.label}</strong>
                    <span className="muted"> · {a.approverName}</span>
                  </div>
                  <div className="tl-meta">
                    <Pill tone={a.status === 'APPROVED' ? 'ok' : a.status === 'REJECTED' ? 'bad' : 'neutral'}>
                      {a.status === 'APPROVED' ? 'Approved' : a.status === 'REJECTED' ? 'Not approved' : 'Waiting'}
                    </Pill>
                    {a.decidedAt && <span className="muted small">{fmtDateTime(a.decidedAt, browserZone())}</span>}
                  </div>
                  {a.comment && <p className="tl-note">{a.comment}</p>}
                </li>
              ))}
            </ol>
          )}
        </TabPanel>

        <TabPanel value="history" className="tab-body">
          <HistoryList reqId={req.id} />
        </TabPanel>
      </TabBar>

      <SendDialog open={dialog === 'send'} req={req} onClose={() => setDialog(null)} />
      <DecideDialog open={dialog === 'approve' || dialog === 'reject'} mode={dialog} req={req} step={myStep} onClose={() => setDialog(null)} />
      <ReasonDialog
        open={dialog === 'hold' || dialog === 'close'}
        mode={dialog}
        req={req}
        onClose={() => setDialog(null)}
      />
      <ReopenDialog open={dialog === 'reopen'} req={req} onClose={() => setDialog(null)} />
      <DeleteDialog open={dialog === 'delete'} req={req} onClose={() => setDialog(null)} />
    </>
  );

}

function HistoryList({ reqId }) {
  const hist = useReqHistory(reqId);
  if (hist.isPending) return <Skeleton rows={3} />;
  const items = hist.data?.history ?? [];
  if (!items.length) return <EmptyState title="No changes yet" />;
  return (
    <ol className="timeline">
      {items.map((h) => (
        <li key={h.id} className="tl-item">
          <div className="tl-main">{h.reason ? `${h.action.replace(/^requisition\./, '').replace(/_/g, ' ')}: ${h.reason}` : h.action.replace(/^requisition\./, '').replace(/_/g, ' ')}</div>
          <div className="tl-meta"><span className="muted small">{h.by_name ?? 'System'} · {fmtDateTime(h.at, browserZone())}</span></div>
        </li>
      ))}
    </ol>
  );
}

function SendDialog({ open, req, onClose }) {
  const [steps, setSteps] = useState(defaultSteps);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const qc = useQueryClient();
  const submit = async () => {
    setErrors({}); setMessage('');
    try {
      const approvers = steps.filter((s) => s.approverId).map((s) => ({ label: s.label.trim(), approverId: Number(s.approverId) }));
      await post(`/api/requisitions/${req.id}/submit`, { approvers });
      REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success('Sent for approval.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fields ?? {}); setMessage(e.message); }
    }
  };
  return (
    <Dialog
      open={open}
      title="Send for approval"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Send</Button></>}
    >
      <p className="muted small">Choose who approves, in order.</p>
      <div className="mt"><ApproverPicker steps={steps} onChange={setSteps} errors={errors} /></div>
      {message && <p role="alert" className="banner bad mt">{message}</p>}
    </Dialog>
  );
}

function DecideDialog({ open, mode, req, step, onClose }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const approve = mode === 'approve';
  const submit = async () => {
    setError('');
    try {
      await post(`/api/requisitions/${req.id}/approvals/${step.id}/decide`, {
        decision: approve ? 'APPROVE' : 'REJECT', comment,
      });
      REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success(approve ? 'Approved. Thank you.' : 'Sent back to the recruiter with your reason.');
      setComment('');
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };
  if (!step) return null;
  return (
    <Dialog
      open={open}
      title={approve ? `Approve: ${step.label}` : `Not approve: ${step.label}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={approve ? 'primary' : 'danger'} onClick={submit}>{approve ? 'Approve' : 'Not approve'}</Button></>}
    >
      <Field label={approve ? 'Note (optional)' : 'Why not? (required)'} error={!approve && comment.trim().length > 0 && comment.trim().length < 3 ? 'Add a few words.' : undefined}>
        {(p) => <textarea {...p} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      {error && <p role="alert" className="banner bad mt">{error}</p>}
    </Dialog>
  );
}

function ReasonDialog({ open, mode, req, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const cmd = useCommand(
    () => post(`/api/requisitions/${req.id}/${mode}`, { reason }),
    { refresh: REFRESH_REQUISITION, success: mode === 'hold' ? 'Role on hold. Its candidates are on hold too.' : 'Role closed.', handled: true },
  );
  const hold = mode === 'hold';
  return (
    <Dialog
      open={open}
      title={hold ? 'Put this role on hold?' : 'Close this role?'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={hold ? 'primary' : 'danger'} disabled={cmd.isPending}
        onClick={async () => {
          setError('');
          try { await cmd.mutateAsync(); setReason(''); onClose(); } catch (e) { setError(e.message); }
        }}>{hold ? 'Put on hold' : 'Close role'}</Button></>}
    >
      <p className="muted small">{hold ? 'Candidates on this role are put on hold. Reopen it later to release them.' : 'Closing ends the search. Candidates on the role are closed too.'}</p>
      <Field label="Why? (required)" error={error || undefined}>
        {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={hold ? 'For example: budget freeze until January' : 'For example: filled internally'} />}
      </Field>
    </Dialog>
  );
}

function ReopenDialog({ open, req, onClose }) {
  const cmd = useCommand(() => post(`/api/requisitions/${req.id}/reopen`, {}), { refresh: REFRESH_REQUISITION, success: 'Role reopened. Candidates are active again.' });
  return (
    <Dialog open={open} title="Reopen this role?" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => cmd.mutate(undefined, { onSuccess: onClose })}>Reopen</Button></>}>
      <p>Candidates who were on hold for this role become active again.</p>
    </Dialog>
  );
}

function DeleteDialog({ open, req, onClose }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <Dialog open={open} title="Delete this draft?" onClose={onClose}
      footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" onClick={async () => {
        try {
          await del(`/api/requisitions/${req.id}`);
          REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
          toast.success('Draft deleted.');
          navigate('/requisitions');
        } catch (e) { toast.error(e.message); }
      }}>Delete draft</Button></>}>
      <p>The draft and its hiring plan are removed. This cannot be undone.</p>
    </Dialog>
  );
}

function PublishButton({ req }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await post(`/api/requisitions/${req.id}/publish`, { published: !req.published });
      REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['careers'] });
      toast.success(req.published ? 'Removed from the careers page.' : 'Now on the careers page.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return <Button disabled={busy} onClick={toggle}>{req.published ? 'Take off the careers page' : 'Publish to careers page'}</Button>;
}

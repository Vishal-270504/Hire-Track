import { useState } from 'react';
import { post } from '../../lib/api.js';
import { useOffers, useCommand, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { useMe, hasPermission } from '../../lib/auth.js';
import { fmtDate, fmtDateTime, browserZone } from '../../lib/format.js';
import { Button, Field, Pill, EmptyState, Skeleton } from '../../components/ui.jsx';
import { Section } from '../../components/kit.jsx';
import { ActionDialog } from './dialogs.jsx';

const OFFER_TONE = { PENDING_APPROVAL: 'warn', SENT: 'accent', NEGOTIATING: 'warn', ACCEPTED: 'ok', DECLINED: 'bad', EXPIRED: 'bad', REVOKED: 'bad', SUPERSEDED: 'neutral' };
const OFFER_TEXT = {
  PENDING_APPROVAL: 'Waiting for approval', SENT: 'Sent, waiting for reply', NEGOTIATING: 'Negotiating',
  ACCEPTED: 'Accepted and signed', DECLINED: 'Declined', EXPIRED: 'Expired', REVOKED: 'Revoked', SUPERSEDED: 'Replaced by a newer version',
};

/** Everything about the offer: the history, the approval, and the candidate's reply. */
export default function OfferPanel({ c }) {
  const me = useMe();
  const offers = useOffers(c.id);
  const [dialog, setDialog] = useState(null);
  const canManage = hasPermission(me.data, 'offer.manage');
  const canApprove = hasPermission(me.data, 'offer.approve');
  // Hooks first, so their order never changes between renders.
  const list = offers.data ?? [];
  const latest = list.find((o) => o.status !== 'SUPERSEDED');
  const open = latest && ['SENT', 'NEGOTIATING'].includes(latest.status);
  const approve = useCommand(() => post(`/api/offers/${latest?.id}/approve`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Offer approved and sent.' });
  const extend = useCommand(() => post(`/api/offers/${latest?.id}/extend`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Offer extended.' });
  if (offers.isPending) return <Skeleton rows={3} />;

  if (c.stage === 'CLOSED' && !list.length) return <EmptyState title="No offer" />;
  return (
    <div className="stack-lg">
      {!list.length && c.phase !== 'OFFER' && (
        <EmptyState title="No offer yet">An offer can be made once the final approval is given.</EmptyState>
      )}

      <Section id="offer-now" title="Current offer" action={canManage && !latest && c.phase === 'OFFER' && (
        <Button variant="primary" onClick={() => setDialog('create')}>Make an offer</Button>
      )}>
        {!latest && list.length > 0 && <p className="muted">The last offer is closed. See the history below.</p>}
        {latest && (
          <div className="offer-card">
            <div className="offer-head">
              <strong className="num">{latest.ctcLpa} LPA</strong>
              <span className="muted">version {latest.version}</span>
              <Pill tone={OFFER_TONE[latest.status]}>{OFFER_TEXT[latest.status]}</Pill>
              {latest.aboveBudget && <Pill tone="warn">Above budget</Pill>}
              {latest.backup && <Pill tone="info">Backup offer</Pill>}
            </div>
            <dl className="facts">
              <div className="fact"><dt>Joining</dt><dd>{fmtDate(latest.joinDate)}</dd></div>
              <div className="fact"><dt>Reply by</dt><dd>{fmtDate(latest.expiryDate)}{latest.extensions ? ` (extended ${latest.extensions}×)` : ''}</dd></div>
              {latest.approvedBy && <div className="fact"><dt>Approved by</dt><dd>{latest.approvedBy}</dd></div>}
              {latest.signName && <div className="fact"><dt>Signed by</dt><dd>{latest.signName}, {fmtDateTime(latest.signAt, browserZone())}</dd></div>}
            </dl>
            {latest.responseNote && <p className="small muted mt">{latest.responseNote}</p>}
            <details className="mt">
              <summary>Offer letter</summary>
              <pre className="pre letter">{latest.letter}</pre>
            </details>

            <div className="round-actions mt">
              {canApprove && latest.status === 'PENDING_APPROVAL' && (
                <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve and send</Button>
              )}
              {canManage && open && (
                <>
                  <Button variant="primary" onClick={() => setDialog('accept')}>Record a yes (signed)</Button>
                  <Button onClick={() => setDialog('negotiate')}>Record a counter-request</Button>
                  <Button onClick={() => setDialog('decline')}>Record a no</Button>
                  <Button onClick={() => setDialog('revise')}>Revise the offer</Button>
                  <Button variant="ghost" disabled={extend.isPending} onClick={() => extend.mutate()}>Extend the reply date</Button>
                </>
              )}
              {canApprove && (open || latest.status === 'PENDING_APPROVAL') && (
                <Button variant="ghost" onClick={() => setDialog('revoke')}>Revoke the offer</Button>
              )}
              {canManage && latest.status === 'ACCEPTED' && (
                <Button variant="ghost" onClick={() => setDialog('backout')}>They backed out</Button>
              )}
            </div>
          </div>
        )}
      </Section>

      {list.length > 1 && (
        <Section id="offer-history" title="Offer history">
          <ul className="flags">
            {list.map((o) => (
              <li key={o.id}>v{o.version}: {o.ctcLpa} LPA, {OFFER_TEXT[o.status].toLowerCase()} ({fmtDate(o.createdAt)})</li>
            ))}
          </ul>
        </Section>
      )}

      <CreateOfferDialog open={dialog === 'create'} onClose={() => setDialog(null)} c={c} canBackup={['HR', 'ADMIN'].includes(me.data?.role)} />
      {latest && (
        <>
          <ReplyDialog open={dialog === 'accept'} onClose={() => setDialog(null)} offer={latest} kind="accept" />
          <ReplyDialog open={dialog === 'negotiate'} onClose={() => setDialog(null)} offer={latest} kind="negotiate" />
          <ReplyDialog open={dialog === 'decline'} onClose={() => setDialog(null)} offer={latest} kind="decline" />
          <ReviseDialog open={dialog === 'revise'} onClose={() => setDialog(null)} c={c} offer={latest} />
          <ReplyDialog open={dialog === 'revoke'} onClose={() => setDialog(null)} offer={latest} kind="revoke" />
          <ReplyDialog open={dialog === 'backout'} onClose={() => setDialog(null)} offer={latest} kind="backout" />
        </>
      )}
    </div>
  );
}

function CreateOfferDialog({ open, onClose, c, canBackup }) {
  const [ctc, setCtc] = useState('');
  const [fixed, setFixed] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [backup, setBackup] = useState(false);
  return (
    <ActionDialog open={open} onClose={onClose} title={`Offer to ${c.name}`} submitLabel="Send offer"
      run={() => post(`/api/candidates/${c.id}/offers`, {
        ctcLpa: Number(ctc), fixedLpa: fixed === '' ? null : Number(fixed), joinDate, backup,
      })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Within budget, the offer is sent at once. Above budget, it waits for an approver.</p>
          <div className="form-grid">
            <Field label="CTC (LPA)" error={errors.ctcLpa}>{(p) => <input {...p} type="number" step="0.5" value={ctc} onChange={(e) => setCtc(e.target.value)} />}</Field>
            <Field label="Fixed part (LPA, optional)" error={errors.fixedLpa}>{(p) => <input {...p} type="number" step="0.5" value={fixed} onChange={(e) => setFixed(e.target.value)} />}</Field>
            <Field label="Joining date" error={errors.joinDate}>{(p) => <input {...p} type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />}</Field>
          </div>
          {canBackup && (
            <label className="check">
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              This is a backup offer (in case the first one is declined)
            </label>
          )}
          {errors.headcount && <p className="field-msg bad">{errors.headcount}</p>}
        </div>
      )}
    </ActionDialog>
  );
}

function ReviseDialog({ open, onClose, c, offer }) {
  const [ctc, setCtc] = useState(String(offer.ctcLpa));
  const [joinDate, setJoinDate] = useState(offer.joinDate);
  return (
    <ActionDialog open={open} onClose={onClose} title="Revise the offer" submitLabel="Send the new version"
      run={() => post(`/api/candidates/${c.id}/offers/revise`, { ctcLpa: Number(ctc), joinDate })}>
      {({ errors }) => (
        <div className="form-grid">
          <Field label="New CTC (LPA)" error={errors.ctcLpa}>{(p) => <input {...p} type="number" step="0.5" value={ctc} onChange={(e) => setCtc(e.target.value)} />}</Field>
          <Field label="Joining date" error={errors.joinDate}>{(p) => <input {...p} type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />}</Field>
        </div>
      )}
    </ActionDialog>
  );
}

const REPLY = {
  accept: { title: 'Record a signed yes', label: 'Record the signature', url: (o) => `/api/offers/${o.id}/accept` },
  negotiate: { title: 'Record a counter-request', label: 'Save', url: (o) => `/api/offers/${o.id}/negotiate` },
  decline: { title: 'Record a no', label: 'Record the decline', url: (o) => `/api/offers/${o.id}/decline` },
  revoke: { title: 'Revoke this offer?', label: 'Revoke offer', url: (o) => `/api/candidates/${o.candidateId}/revoke`, tone: 'danger' },
  backout: { title: 'Record that they backed out?', label: 'Record back-out', url: (o) => `/api/candidates/${o.candidateId}/backed-out`, tone: 'danger' },
};

/** One dialog for each reply the candidate can give. The typed name is the e-signature on a yes. */
function ReplyDialog({ open, onClose, offer, kind }) {
  const [text, setText] = useState('');
  const cfg = REPLY[kind];
  const body = () => {
    if (kind === 'accept') return { signName: text };
    if (kind === 'negotiate') return { note: text };
    return { reason: text };
  };
  const prompt = {
    accept: ['Type the candidate’s full name as their signature', 'Their name'],
    negotiate: ['What did they ask for?', 'Describe the request'],
    decline: ['Why did they decline?', 'Reason'],
    revoke: ['Why is the offer being revoked?', 'Reason (for example, a background check finding)'],
    backout: ['Why did they back out?', 'Reason'],
  }[kind];
  return (
    <ActionDialog open={open} onClose={onClose} title={cfg.title} submitLabel={cfg.label} tone={cfg.tone ?? 'primary'}
      run={() => post(cfg.url(offer), body())}>
      {({ errors }) => (
        <Field label={prompt[0]} error={errors.signName ?? errors.note ?? errors.reason}>
          {(p) => <input {...p} value={text} placeholder={prompt[1]} onChange={(e) => setText(e.target.value)} />}
        </Field>
      )}
    </ActionDialog>
  );
}

export { useCommand };

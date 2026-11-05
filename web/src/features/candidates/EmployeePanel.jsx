import { useState, useEffect } from 'react';
import { post } from '../../lib/api.js';
import { useEmployee, useSettingsValues, useCommand, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { useMe, hasPermission } from '../../lib/auth.js';
import { fmtDate, fmtDateTime, browserZone } from '../../lib/format.js';
import { Button, Field, Pill, EmptyState, Skeleton, Dialog } from '../../components/ui.jsx';
import { Section } from '../../components/kit.jsx';
import { ActionDialog } from './dialogs.jsx';
import { Select } from '../../components/Select.jsx';

const STATUS_TONE = { 'On track': 'ok', Extended: 'warn', 'Needs improvement (PIP)': 'bad', Confirmed: 'ok', Separated: 'neutral', Onboarding: 'accent' };
const ASSET_TEXT = { LAPTOP: 'Laptop', ID_CARD: 'ID card', HEADSET: 'Headset', ACCESS_CARD: 'Access card' };
const PERIOD_TEXT = { '30': '30-day review', '60': '60-day review', '90': '90-day review', FINAL: 'Final review' };

/** After joining: onboarding checklist, assets, probation, improvement plans, and the decisions. */
export default function EmployeePanel({ c }) {
  const me = useMe();
  const eid = c.employeeId;
  const emp = useEmployee(eid);
  const settings = useSettingsValues();
  const [dialog, setDialog] = useState(null);
  const canOnboard = hasPermission(me.data, 'onboarding.manage');
  const canProbation = hasPermission(me.data, 'probation.manage');
  if (!eid) return <EmptyState title="Not joined yet">Onboarding and probation appear after Day 1.</EmptyState>;
  if (emp.isPending) return <Skeleton rows={5} />;
  if (emp.error) return <div role="alert" className="banner bad">{emp.error.message}</div>;
  const e = emp.data;
  const criteria = settings.data?.values?.probation?.criteria ?? [];
  const openPip = e.pips.find((p) => p.status === 'ACTIVE');
  const final = e.reviews.find((r) => r.period === 'FINAL');
  const nr = e.nextReview;

  return (
    <div className="stack-lg">
      <Section id="emp-head" title={`${e.employeeCode} · ${e.companyEmail}`} action={<Pill tone={STATUS_TONE[e.displayStatus] ?? 'neutral'}>{e.displayStatus}</Pill>}>
        <dl className="facts">
          <div className="fact"><dt>Joined</dt><dd>{fmtDate(e.joinedOn)}</dd></div>
          <div className="fact"><dt>Probation ends</dt><dd>{e.probationEnd ? `${fmtDate(e.probationEnd)} (${e.daysLeft} days)` : 'Starts when access is live'}</dd></div>
          <div className="fact"><dt>Next review</dt><dd>{nr ? `${PERIOD_TEXT[nr.period]}, due ${fmtDate(nr.due)}${nr.late ? ' (late)' : ''}` : e.status === 'PROBATION' ? 'All reviews done' : '—'}</dd></div>
          <div className="fact"><dt>Access</dt><dd>{e.accessRestricted ? 'Restricted until background checks clear' : 'Normal'}</dd></div>
        </dl>
        {canProbation && e.status === 'PROBATION' && (
          <div className="round-actions mt">
            {!openPip && final?.status === 'APPROVED' && final.weighted >= 3 && (
              <Button variant="primary" onClick={() => setDialog('confirm')}>Confirm employment</Button>
            )}
            {!openPip && <Button onClick={() => setDialog('pip')}>Start an improvement plan</Button>}
            {!e.extended && final?.status === 'APPROVED' && final.weighted >= 2.5 && final.weighted < 3 && (
              <Button onClick={() => setDialog('extend')}>Extend probation once</Button>
            )}
            {(final || e.reviews.some((r) => r.weighted < 2.5)) && <Button variant="danger" onClick={() => setDialog('separate')}>Separate during probation</Button>}
          </div>
        )}
        {e.status === 'CONFIRMED' && (
          <div className="round-actions mt"><Button onClick={() => setDialog('letter-confirm')}>Confirmation letter</Button></div>
        )}
        {e.status === 'SEPARATED' && (
          <div className="round-actions mt">
            <Button onClick={() => setDialog('letter-term')}>Termination letter</Button>
            <span className="small muted">Last day {fmtDate(e.separatedOn)} · {e.separationReason}</span>
          </div>
        )}
      </Section>

      {(e.onboarding ?? []).length > 0 && (
        <Section id="onboarding" title="Onboarding checklist">
          <div className="check-grid">
            {e.onboarding.map((it) => (
              <CheckItem key={it.id} item={it} employeeId={e.id} canEdit={canOnboard} c={c} />
            ))}
          </div>
          <p className="muted small mt">Probation starts automatically once every access item is ticked.</p>
        </Section>
      )}

      <Section id="assets" title="Assets" action={canOnboard && <Button onClick={() => setDialog('asset')}>Record an asset</Button>}>
        {e.assets.length === 0 ? <p className="muted">No assets recorded.</p> : (
          <ul className="doc-list">
            {e.assets.map((a) => (
              <AssetRow key={a.id} a={a} canEdit={canOnboard} c={c} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="reviews" title="Probation reviews" action={canProbation && nr && (
        <Button variant="primary" onClick={() => setDialog('review')}>Record the {PERIOD_TEXT[nr.period].toLowerCase()}</Button>
      )}>
        {e.reviews.length === 0 ? <p className="muted">No reviews yet. The first is at 30 days.</p> : (
          <table className="table">
            <thead><tr><th>Review</th><th className="num">Score</th><th>Outcome</th><th>Status</th><th>Written by</th><th /></tr></thead>
            <tbody>
              {e.reviews.map((r) => (
                <tr key={r.id}>
                  <td>{PERIOD_TEXT[r.period]}</td>
                  <td className="num"><strong>{r.weighted.toFixed(2)}</strong> / 5</td>
                  <td>{r.outcome}</td>
                  <td><Pill tone={r.status === 'APPROVED' ? 'ok' : 'accent'}>{r.status === 'APPROVED' ? `Approved by ${r.approvedBy}` : 'Waiting for approval'}</Pill></td>
                  <td className="muted small">{r.submittedBy}</td>
                  <td>{canProbation && r.status === 'SUBMITTED' && r.submittedBy !== me.data?.name && (
                    <ApproveButton empId={e.id} period={r.period} />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {e.reviews.length > 0 && (
          <p className="small muted mt">Trend: {e.reviews.map((r) => `${PERIOD_TEXT[r.period].split(' ')[0]} ${r.weighted.toFixed(2)}`).join('  →  ')}</p>
        )}
      </Section>

      {e.pips.length > 0 && (
        <Section id="pips" title="Improvement plans">
          {e.pips.map((p) => (
            <PipCard key={p.id} pip={p} canEdit={canProbation} />
          ))}
        </Section>
      )}

      {true && (
        <Section id="surveys" title="Onboarding surveys" action={canProbation && <Button onClick={() => setDialog('survey')}>Record a survey</Button>}>
          {e.surveys.length === 0 ? <p className="muted">Survey at day 30 and day 90.</p> : (
            <ul className="flags">{e.surveys.map((s) => <li key={s.id}>Day {s.day}: {s.rating} of 5{s.comment ? `. ${s.comment}` : ''}</li>)}</ul>
          )}
        </Section>
      )}

      <AssetDialog open={dialog === 'asset'} onClose={() => setDialog(null)} empId={e.id} />
      <ReviewDialog open={dialog === 'review'} onClose={() => setDialog(null)} empId={e.id} period={nr?.period} criteria={criteria} />
      <PipDialog open={dialog === 'pip'} onClose={() => setDialog(null)} empId={e.id} />
      <ExtendDialog open={dialog === 'extend'} onClose={() => setDialog(null)} empId={e.id} />
      <SeparateDialog open={dialog === 'separate'} onClose={() => setDialog(null)} empId={e.id} isAdmin={me.data?.role === 'ADMIN'} />
      <SurveyDialog open={dialog === 'survey'} onClose={() => setDialog(null)} empId={e.id} />
      <ConfirmDialog2 open={dialog === 'confirm'} onClose={() => setDialog(null)} empId={e.id} />
      <LetterDialog open={dialog === 'letter-confirm' || dialog === 'letter-term'} onClose={() => setDialog(null)} empId={e.id} kind={dialog === 'letter-term' ? 'termination' : 'confirmation'} />
    </div>
  );
}

function CheckItem({ item, employeeId, canEdit, c }) {
  const toggle = useCommand((done) => post(`/api/employees/${employeeId}/items/${encodeURIComponent(item.itemKey)}`, { done }),
    { refresh: REFRESH_ALL_CANDIDATE, handled: false });
  return (
    <label className={`check-item ${item.done ? 'is-done' : ''}`}>
      <input type="checkbox" checked={!!item.done} disabled={!canEdit || toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
      <span>{item.label}</span>
      <span className="small muted">{item.ownerTeam}</span>
    </label>
  );
}

function AssetRow({ a, canEdit, c }) {
  const ret = useCommand(() => post(`/api/assets/${a.id}/return`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Marked returned.' });
  return (
    <li className="doc-row">
      <div className="doc-main">
        <strong>{ASSET_TEXT[a.assetType]}</strong>
        {a.serial && <span className="num small">Serial {a.serial}</span>}
        {a.loaner && <Pill tone="warn">Loaner</Pill>}
        {a.returnedAt ? <span className="small muted">Returned {fmtDate(a.returnedAt)}</span> : <span className="small muted">Issued {fmtDate(a.issuedAt)}</span>}
      </div>
      {canEdit && !a.returnedAt && <div className="round-actions"><Button variant="ghost" onClick={() => ret.mutate()}>Mark returned</Button></div>}
    </li>
  );
}

function ApproveButton({ empId, period }) {
  const approve = useCommand(() => post(`/api/employees/${empId}/reviews/${period}/approve`, {}), { refresh: REFRESH_ALL_CANDIDATE, success: 'Review approved.' });
  return <Button variant="ghost" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve</Button>;
}

function PipCard({ pip, canEdit }) {
  const [note, setNote] = useState('');
  const add = useCommand(() => post(`/api/pips/${pip.id}/checkins`, { note }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Check-in saved.' });
  const close = useCommand((result) => post(`/api/pips/${pip.id}/close`, { result }), { refresh: REFRESH_ALL_CANDIDATE, success: 'Plan closed.' });
  return (
    <div className="pip">
      <div className="round-view-head">
        <strong>{pip.months}-month plan, {fmtDate(pip.startOn)} to {fmtDate(pip.endOn)}</strong>
        <Pill tone={pip.status === 'ACTIVE' ? 'bad' : pip.status === 'PASSED' ? 'ok' : 'neutral'}>{pip.status === 'ACTIVE' ? 'Active' : pip.status === 'PASSED' ? 'Passed' : 'Not met'}</Pill>
      </div>
      <ul className="flags">{pip.goals.map((g) => <li key={g}>{g}</li>)}</ul>
      {pip.status === 'ACTIVE' && canEdit && (
        <>
          <div className="round-actions mt">
            <input aria-label="Weekly check-in note" placeholder="What was discussed this week?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
            <Button disabled={note.trim().length < 3 || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setNote('') })}>Save check-in</Button>
          </div>
          <div className="round-actions">
            <Button variant="primary" onClick={() => close.mutate('PASSED')}>Goals met</Button>
            <Button variant="ghost" onClick={() => close.mutate('FAILED')}>Goals not met</Button>
          </div>
        </>
      )}
      {pip.checkins.length > 0 && (
        <ul className="small muted mt">{pip.checkins.map((k) => <li key={k.at}>{fmtDate(k.at)}: {k.note}</li>)}</ul>
      )}
    </div>
  );
}

function AssetDialog({ open, onClose, empId }) {
  const [assetType, setType] = useState('LAPTOP');
  const [serial, setSerial] = useState('');
  const [loaner, setLoaner] = useState(false);
  return (
    <ActionDialog open={open} onClose={onClose} title="Record an asset" submitLabel="Record"
      run={() => post(`/api/employees/${empId}/assets`, { assetType, serial, loaner })}>
      {({ errors }) => (
        <div className="stack">
          <Field label="What" error={errors.assetType}>
            {(p) => <Select {...p} value={assetType} onChange={(e) => setType(e.target.value)}>
              {Object.entries(ASSET_TEXT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>}
          </Field>
          <Field label="Serial number" error={errors.serial}>{(p) => <input {...p} value={serial} onChange={(e) => setSerial(e.target.value)} />}</Field>
          <label className="check"><input type="checkbox" checked={loaner} onChange={(e) => setLoaner(e.target.checked)} /> Loaner laptop (issued in place of a laptop not yet ready)</label>
        </div>
      )}
    </ActionDialog>
  );
}

function ReviewDialog({ open, onClose, empId, period, criteria }) {
  const [scores, setScores] = useState({});
  const [lead, setLead] = useState('');
  const [buddy, setBuddy] = useState('');
  const allScored = criteria.every((c) => scores[c.name]);
  return (
    <ActionDialog open={open} onClose={onClose} title={`Record the ${PERIOD_TEXT[period] ?? 'review'}`} submitLabel="Submit review"
      run={() => post(`/api/employees/${empId}/reviews`, {
        period, scores: Object.fromEntries(criteria.map((c) => [c.name, Number(scores[c.name])])), leadComments: lead, buddyComments: buddy,
      })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Score each criterion from 1 to 5. The weighted score uses the weights in Settings.</p>
          {criteria.map((c) => (
            <Field key={c.name} label={`${c.name} (${c.weight}%)`} error={errors.scores}>
              {(p) => <Select {...p} value={scores[c.name] ?? ''} onChange={(e) => setScores((s) => ({ ...s, [c.name]: e.target.value }))}>
                <option value="">Choose</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>}
            </Field>
          ))}
          <Field label="Manager's comments"><textarea rows={2} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
          <Field label="Buddy's input (optional)"><textarea rows={2} value={buddy} onChange={(e) => setBuddy(e.target.value)} /></Field>
          {!allScored && <p className="small muted">Score every criterion to submit.</p>}
        </div>
      )}
    </ActionDialog>
  );
}

function PipDialog({ open, onClose, empId }) {
  const [months, setMonths] = useState(1);
  const [goals, setGoals] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Start an improvement plan" submitLabel="Start plan"
      run={() => post(`/api/employees/${empId}/pip`, { months: Number(months), goals: goals.split('\n').map((g) => g.trim()).filter(Boolean) })}>
      {({ errors }) => (
        <div className="stack">
          <Field label="Length (months)" error={errors.months}>{(p) => <Select {...p} value={months} onChange={(e) => setMonths(e.target.value)}>{[1, 2, 3].map((m) => <option key={m} value={m}>{m}</option>)}</Select>}</Field>
          <Field label="Goals (one per line)" error={errors.goals}>{(p) => <textarea {...p} rows={4} value={goals} onChange={(e) => setGoals(e.target.value)} />}</Field>
        </div>
      )}
    </ActionDialog>
  );
}

function ExtendDialog({ open, onClose, empId }) {
  const [months, setMonths] = useState(1);
  const [goals, setGoals] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Extend probation once" submitLabel="Extend with a plan"
      run={() => post(`/api/employees/${empId}/extend`, { months: Number(months), goals: goals.split('\n').map((g) => g.trim()).filter(Boolean) })}>
      {({ errors }) => (
        <div className="stack">
          <p className="muted small">Only once, and only when the final score is in the improvement range. It comes with a plan.</p>
          <Field label="Extra months" error={errors.months}>{(p) => <Select {...p} value={months} onChange={(e) => setMonths(e.target.value)}>{[1, 2, 3].map((m) => <option key={m} value={m}>{m}</option>)}</Select>}</Field>
          <Field label="Goals (one per line)" error={errors.goals}>{(p) => <textarea {...p} rows={4} value={goals} onChange={(e) => setGoals(e.target.value)} />}</Field>
        </div>
      )}
    </ActionDialog>
  );
}

function SeparateDialog({ open, onClose, empId, isAdmin }) {
  const [reason, setReason] = useState('');
  const [misconduct, setMisconduct] = useState(false);
  const [reviewsDocumented, setDoc] = useState(false);
  const [pipGiven, setPip] = useState(false);
  const [hrHead, setHead] = useState(false);
  const [rehire, setRehire] = useState(true);
  const [lastDay, setLastDay] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Separate during probation" submitLabel="Record separation" tone="danger"
      run={() => post(`/api/employees/${empId}/separate`, { reason, misconduct, reviewsDocumented, pipGivenOrMisconduct: pipGiven || misconduct, hrHeadApproved: hrHead, rehireEligible: rehire, lastDay: lastDay || undefined })}>
      {({ errors }) => (
        <div className="stack">
          <p className="small muted">Check each point. The process must be fair: reviews on time and shared, an improvement plan given, and approval from the HR head.</p>
          <Field label="Reason" error={errors.reason}>{(p) => <textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <label className="check"><input type="checkbox" checked={misconduct} onChange={(e) => setMisconduct(e.target.checked)} /> Serious misconduct (data leak, harassment, fraud). Skips the improvement plan.</label>
          {!misconduct && (
            <>
              <label className="check"><input type="checkbox" checked={reviewsDocumented} onChange={(e) => setDoc(e.target.checked)} /> Reviews were on time and the feedback was shared</label>
              <label className="check"><input type="checkbox" checked={pipGiven} onChange={(e) => setPip(e.target.checked)} /> An improvement plan was given with clear goals</label>
            </>
          )}
          <label className="check"><input type="checkbox" checked={hrHead} onChange={(e) => setHead(e.target.checked)} disabled={!isAdmin} /> HR head has approved{!isAdmin && ' (an admin records this)'}</label>
          <Field label="Last working day (optional)" error={errors.lastDay}>{(p) => <input {...p} type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />}</Field>
          <label className="check"><input type="checkbox" checked={rehire} onChange={(e) => setRehire(e.target.checked)} /> Eligible to be rehired</label>
        </div>
      )}
    </ActionDialog>
  );
}

function SurveyDialog({ open, onClose, empId }) {
  const [day, setDay] = useState(30);
  const [rating, setRating] = useState(4);
  const [comment, setComment] = useState('');
  return (
    <ActionDialog open={open} onClose={onClose} title="Record an onboarding survey" submitLabel="Record survey"
      run={() => post(`/api/employees/${empId}/surveys`, { day: Number(day), rating: Number(rating), comment })}>
      <div className="form-grid">
        <Field label="Survey"><Select value={day} onChange={(e) => setDay(e.target.value)}><option value={30}>Day 30</option><option value={90}>Day 90</option></Select></Field>
        <Field label="Rating (1 to 5)"><Select value={rating} onChange={(e) => setRating(e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
      </div>
      <Field label="Comments"><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    </ActionDialog>
  );
}

function ConfirmDialog2({ open, onClose, empId }) {
  return (
    <ActionDialog open={open} onClose={onClose} title="Confirm employment?" submitLabel="Confirm"
      run={() => post(`/api/employees/${empId}/confirm`, {})}>
      <p>They are confirmed in employment and the confirmation letter is ready to send.</p>
    </ActionDialog>
  );
}

function LetterDialog({ open, onClose, empId, kind }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const load = async () => {
    setErr('');
    try {
      const res = await fetch(`/api/employees/${empId}/letters/${kind}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setText(data.text);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { if (open && !text && !err) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} title={kind === 'termination' ? 'Termination letter' : 'Confirmation letter'} onClose={() => { setText(''); onClose(); }}
      footer={<Button onClick={() => { setText(''); onClose(); }}>Close</Button>}>
      {err ? <p role="alert" className="banner bad">{err}</p> : <pre className="pre letter">{text || 'Loading…'}</pre>}
    </Dialog>
  );
}


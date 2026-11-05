import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { put, post, ApiError } from '../../lib/api.js';
import { useSettings } from '../../lib/data.js';
import { hasPermission, useMe } from '../../lib/auth.js';
import { Button, Field, PageHeader, Skeleton, ConfirmDialog } from '../../components/ui.jsx';
import { TabBar, TabPanel } from '../../components/kit.jsx';

/*
 * Every editable number and list in the process. One spec per area describes its fields, so
 * the page stays small and each area gets the same save, reset and error handling.
 *   kind: 'num' | 'bool' | 'list' (numbers, comma separated) | 'lines' (one item per line) | 'text' | 'criteria' | 'weights'
 */
const AREAS = [
  {
    id: 'screening', label: 'Screening',
    blocks: [{
      key: 'ats', title: 'Resume score',
      lead: 'How a resume is scored out of 100. The five weights must add up to exactly 100.',
      fields: [
        { path: 'weights.mustHave', label: 'Must-have skills', kind: 'num', min: 0, max: 100 },
        { path: 'weights.experience', label: 'Experience fit', kind: 'num', min: 0, max: 100 },
        { path: 'weights.goodToHave', label: 'Good-to-have skills', kind: 'num', min: 0, max: 100 },
        { path: 'weights.education', label: 'Education and certificates', kind: 'num', min: 0, max: 100 },
        { path: 'weights.stability', label: 'Stability (job gaps and tenure)', kind: 'num', min: 0, max: 100 },
        { path: 'shortlistAt', label: 'Shortlist from (score)', kind: 'num', min: 1, max: 100, hint: 'Shortlisted at or above this score.' },
        { path: 'reviewAt', label: 'Manual review from (score)', kind: 'num', min: 0, max: 100, hint: 'Between this and the shortlist mark, a person reads it. Below this, it is rejected with an undo window.' },
      ],
      weightsTotal: ['weights.mustHave', 'weights.experience', 'weights.goodToHave', 'weights.education', 'weights.stability'],
    }],
  },
  {
    id: 'interviews', label: 'Interviews',
    blocks: [{
      key: 'interviews', title: 'Interview rules',
      fields: [
        { path: 'r1PassPercent', label: 'Default pass mark for online tests (%)', kind: 'num', min: 0, max: 100 },
        { path: 'roundPassAverage', label: 'Default pass average for interviews (1 to 5)', kind: 'num', min: 1, max: 5, step: 0.5 },
        { path: 'rescheduleLimit', label: 'Times a round can be moved before HR must approve', kind: 'num', min: 0, max: 5 },
        { path: 'noShowRebookOnce', label: 'Offer one rebook after a no-show', kind: 'bool' },
        { path: 'feedbackHours', label: 'Hours after an interview to ask for feedback', kind: 'num', min: 1, max: 168 },
        { path: 'feedbackEscalateHours', label: 'Hours before feedback is escalated to HR', kind: 'num', min: 1, max: 336 },
        { path: 'candidateUpdateHours', label: 'Hours between updates to a candidate', kind: 'num', min: 1, max: 336 },
        { path: 'reminderHoursBefore', label: 'Remind interviewers this many hours before', kind: 'list' },
      ],
    }],
  },
  {
    id: 'offers', label: 'Offers and joining',
    blocks: [
      {
        key: 'offer', title: 'Offers',
        fields: [
          { path: 'validityDays', label: 'Days an offer stays open', kind: 'num', min: 1, max: 30 },
          { path: 'reminderHoursBefore', label: 'Remind before it expires (hours)', kind: 'list' },
          { path: 'extensionDays', label: 'Days added by one extension', kind: 'num', min: 1, max: 30 },
          { path: 'maxExtensions', label: 'Extensions allowed', kind: 'num', min: 0, max: 3 },
        ],
      },
      {
        key: 'notice', title: 'Notice period',
        fields: [
          { path: 'maxDays', label: 'Longest notice accepted without approval (days)', kind: 'num', min: 0, max: 365 },
          { path: 'buyoutAllowed', label: 'Allow buying out the notice period', kind: 'bool' },
        ],
      },
      {
        key: 'joining', title: 'Joining',
        fields: [
          { path: 'laptopAlertDaysBefore', label: 'Alert IT this many days before joining', kind: 'num', min: 0, max: 30 },
          { path: 'relievingLetterDays', label: 'Days to collect the relieving letter', kind: 'num', min: 1, max: 180 },
          { path: 'checkInEveryDays', label: 'Check in with them every (days) during notice', kind: 'num', min: 1, max: 60 },
          { path: 'maxDateChanges', label: 'Joining date changes allowed', kind: 'num', min: 0, max: 5 },
        ],
      },
      {
        key: 'reapplyCoolingDays', title: 'Re-applying', single: true,
        fields: [{ path: '_', label: 'Days before someone rejected can apply again', kind: 'num', min: 0, max: 730 }],
      },
      {
        key: 'talentPoolFollowUpDays', title: 'Talent pool', single: true,
        fields: [{ path: '_', label: 'Default follow-up after the talent pool (days)', kind: 'num', min: 30, max: 730 }],
      },
    ],
  },
  {
    id: 'probation', label: 'Probation',
    blocks: [{
      key: 'probation', title: 'Probation review',
      lead: 'The weights of each criterion must add up to exactly 100.',
      fields: [
        { path: 'months', label: 'Probation length (months)', kind: 'num', min: 1, max: 12 },
        { path: 'reviewWarningDays', label: 'Remind the manager this many days before a review', kind: 'num', min: 0, max: 30 },
        { path: 'confirmAt', label: 'Confirm from this score (1 to 5)', kind: 'num', min: 1, max: 5, step: 0.1 },
        { path: 'pipAt', label: 'Improvement plan below this score (1 to 5)', kind: 'num', min: 1, max: 5, step: 0.1 },
        { path: 'criteria', label: 'Criteria and weights', kind: 'criteria' },
      ],
    }],
  },
  {
    id: 'lists', label: 'Checklists',
    blocks: [
      { key: 'checklists', title: 'Checklists', lead: 'One item per line. These appear on each candidate’s checklists.', fields: [
        { path: 'documents', label: 'Documents to collect', kind: 'lines' },
        { path: 'access', label: 'Access on day one', kind: 'lines' },
        { path: 'offboarding', label: 'Leaving checklist', kind: 'lines' },
      ] },
      { key: 'bgvChecks', title: 'Background checks', single: true, fields: [{ path: '_', label: 'Checks to run (one per line)', kind: 'lines' }] },
      { key: 'dpdp', title: 'Data retention', fields: [{ path: 'retainAnonymisedReportsDays', label: 'Keep anonymised reports for (days)', kind: 'num', min: 30, max: 3650 }] },
    ],
  },
  {
    id: 'messages', label: 'Messages',
    blocks: [{
      key: 'templates', title: 'Message text',
      lead: 'Drafts you copy into email or WhatsApp. Words in {braces} are filled in for each person.',
      fields: [
        { path: 'interviewInvite', label: 'Interview invitation', kind: 'text' },
        { path: 'interviewReminder', label: 'Interview reminder', kind: 'text' },
        { path: 'rescheduleLink', label: 'Ask to pick a new time', kind: 'text' },
        { path: 'rejection', label: 'Rejection', kind: 'text' },
        { path: 'offerReminder', label: 'Offer reminder', kind: 'text' },
        { path: 'feedbackNudge', label: 'Feedback reminder to interviewers', kind: 'text' },
        { path: 'candidateUpdate', label: 'Status update', kind: 'text' },
        { path: 'welcome', label: 'Welcome email for Day 1', kind: 'text' },
        { path: 'offerLetter', label: 'Offer letter', kind: 'text' },
        { path: 'confirmationLetter', label: 'Confirmation letter', kind: 'text' },
        { path: 'terminationLetter', label: 'Termination letter', kind: 'text' },
      ],
    }, { key: 'companyName', title: 'Company name', single: true, fields: [{ path: '_', label: 'Shown in letters and emails', kind: 'text' }] }],
  },
];

const getPath = (obj, path) => (path === '_' ? obj : path.split('.').reduce((o, k) => o?.[k], obj));
function setPath(obj, path, value) {
  if (path === '_') return value;
  const copy = structuredClone(obj);
  const keys = path.split('.');
  let cur = copy;
  keys.slice(0, -1).forEach((k) => { cur = cur[k]; });
  cur[keys.at(-1)] = value;
  return copy;
}

const toDraft = (field, value) => {
  if (field.kind === 'list') return (value ?? []).join(', ');
  if (field.kind === 'lines') return (value ?? []).join('\n');
  if (field.kind === 'criteria') return (value ?? []).map((c) => `${c.name} | ${c.weight}`).join('\n');
  return value ?? '';
};
const fromDraft = (field, raw) => {
  if (field.kind === 'num') return raw === '' ? null : Number(raw);
  if (field.kind === 'bool') return !!raw;
  if (field.kind === 'list') return String(raw).split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (field.kind === 'lines') return String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
  if (field.kind === 'criteria') return String(raw).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, weight] = l.split('|').map((s) => s.trim());
    return { name, weight: Number(weight) };
  });
  return raw;
};

export default function SettingsPage() {
  const me = useMe();
  const s = useSettings();
  const [tab, setTab] = useState('screening');
  const canWrite = hasPermission(me.data, 'settings.write');

  if (s.isPending) return <Skeleton rows={6} />;
  if (s.error) return <div role="alert" className="banner bad">{s.error.message}</div>;
  const area = AREAS.find((a) => a.id === tab);
  return (
    <>
      <PageHeader
        title="Settings"
        lead={canWrite
          ? 'The numbers and words the process uses. Each area saves on its own. Reset returns it to the plan’s values.'
          : 'The rules the process follows. Only HR and admins can change them.'}
      />
      <TabBar value={tab} onValueChange={setTab} items={AREAS.map((a) => ({ value: a.id, label: a.label }))}>
        {AREAS.map((a) => (
          <TabPanel key={a.id} value={a.id} className="tab-body">
            <div className="stack-lg">
              {a.blocks.map((b) => (
                <PolicyBlock
                  key={b.key}
                  block={b}
                  value={s.data.values[b.key]}
                  defaults={s.data.defaults[b.key]}
                  customised={s.data.customised.includes(b.key)}
                  canWrite={canWrite}
                />
              ))}
            </div>
          </TabPanel>
        ))}
      </TabBar>
      {!area && null}
    </>
  );
}

function PolicyBlock({ block, value, defaults, customised, canWrite }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(block.fields.map((f) => [f.path, toDraft(f, getPath(value, f.path))])));
    setErrors({});
    setMessage('');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const weightSum = block.weightsTotal
    ? block.weightsTotal.reduce((sum, p) => sum + (Number(drafts[p]) || 0), 0)
    : null;

  const dirty = block.fields.some((f) => drafts[f.path] !== toDraft(f, getPath(value, f.path)));

  async function save() {
    setBusy(true); setErrors({}); setMessage('');
    try {
      let next = structuredClone(value);
      for (const f of block.fields) next = setPath(next, f.path, fromDraft(f, drafts[f.path]));
      const url = `/api/settings/${block.key}`;
      await put(url, next);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`${block.title} saved.`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setMessage(e.message);
        if (e.fields?._) setMessage(e.fields._);
      } else setMessage('Could not save. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <section className="panel stack" aria-labelledby={`b-${block.key}`}>
      <header className="section-head">
        <div>
          <h2 id={`b-${block.key}`}>{block.title}</h2>
          {block.lead && <p className="muted small lead">{block.lead}</p>}
        </div>
        <div className="page-actions">
          {customised && <span className="pill-note">Changed from the plan</span>}
          {canWrite && customised && (
            <Button variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw size={16} aria-hidden="true" /> Reset to plan</Button>
          )}
        </div>
      </header>

      <div className={block.single ? '' : 'form-grid'}>
        {block.fields.map((f) => (
          <Field key={f.path} label={f.label} hint={f.hint} error={errors[f.path === '_' ? block.key : f.path] ?? errors._ ? undefined : undefined}>
            {(p) => {
              const common = { ...p, disabled: !canWrite, value: drafts[f.path] ?? '', onChange: (e) => setDrafts((d) => ({ ...d, [f.path]: f.kind === 'bool' ? e.target.checked : e.target.value })) };
              if (f.kind === 'num') return <input {...common} type="number" min={f.min} max={f.max} step={f.step ?? 1} />;
              if (f.kind === 'bool') return <input {...p} type="checkbox" disabled={!canWrite} checked={!!drafts[f.path]} onChange={(e) => setDrafts((d) => ({ ...d, [f.path]: e.target.checked }))} />;
              if (f.kind === 'text' || f.kind === 'lines' || f.kind === 'criteria') return <textarea {...common} rows={f.kind === 'text' ? 3 : 4} />;
              return <input {...common} />;
            }}
          </Field>
        ))}
      </div>

      {weightSum != null && (
        <p className={`small ${weightSum === 100 ? 'ok-text' : 'bad-text'}`} role="status">
          Total: {weightSum} of 100 {weightSum === 100 ? '' : '(must be exactly 100 to save)'}
        </p>
      )}
      {message && <p role="alert" className="banner bad">{message}</p>}
      {canWrite && (
        <div className="form-foot">
          {!dirty && <span className="muted small">No changes</span>}
          <Button variant="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title={`Reset ${block.title} to the plan?`}
        consequence="The values go back to the ones in the hiring plan. Anything you changed here is lost."
        confirmLabel="Reset"
        tone="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          try {
            await post(`/api/settings/${block.key}/reset`, {});
            qc.invalidateQueries({ queryKey: ['settings'] });
            toast.success(`${block.title} reset.`);
          } catch (e) { toast.error(e.message); }
        }}
      />
      {defaults && null}
    </section>
  );
}

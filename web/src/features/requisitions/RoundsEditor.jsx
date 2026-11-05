import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { put, post, ApiError } from '../../lib/api.js';
import { useTemplates, useRequisitions, useCommand, REFRESH_REQUISITION } from '../../lib/data.js';
import { ROUND_TYPE_TEXT } from '../../lib/format.js';
import { Button, Field, ConfirmDialog } from '../../components/ui.jsx';
import { ChipInput, MoveUp, MoveDown, Section } from '../../components/kit.jsx';
import { Select } from '../../components/Select.jsx';

const blankRound = (type = 'SCORECARD') => ({
  name: '', type, durationMin: 60, who: '', format: '', skills: [],
  passPercent: type === 'ONLINE_TEST' ? 60 : null,
  passAverage: type === 'SCORECARD' || type === 'TAKE_HOME' ? 3 : null,
  optional: false,
});

const fromServer = (r) => ({ ...r });

/**
 * The hiring plan: the ordered rounds for a role. Used in the wizard and on the role page.
 * Plain words for each round type; the pass mark field changes with the type.
 */
export default function RoundsEditor({ requisition, editable = true, onSaved, compact = false }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const others = useRequisitions();
  const [rows, setRows] = useState(() => requisition.rounds.map(fromServer));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickTemplate, setPickTemplate] = useState('');
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  useEffect(() => { setRows(requisition.rounds.map(fromServer)); }, [requisition.id, requisition.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  };

  const update = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const move = (i, dir) => setRows((rs) => {
    const next = [...rs];
    const j = i + dir;
    if (j < 0 || j >= next.length) return rs;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save() {
    setBusy(true); setErrors({}); setFormError('');
    try {
      const payload = {
        version: requisition.version,
        rounds: rows.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name, type: r.type,
          durationMin: r.durationMin === '' || r.durationMin == null ? null : Number(r.durationMin),
          who: r.who ?? '', format: r.format ?? '', skills: r.skills ?? [],
          passPercent: r.type === 'ONLINE_TEST' ? Number(r.passPercent) : null,
          passAverage: r.type === 'SCORECARD' || r.type === 'TAKE_HOME' ? Number(r.passAverage) : null,
          optional: !!r.optional,
        })),
      };
      const res = await put(`/api/requisitions/${requisition.id}/plan`, payload);
      refresh();
      onSaved?.(res.requisition);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setFormError(e.message);
      } else setFormError('Could not save the plan. Please try again.');
    } finally { setBusy(false); }
  }

  const applyTemplate = useCommand(
    () => post(`/api/requisitions/${requisition.id}/plan/template`, { templateId: pickTemplate }),
    { refresh: REFRESH_REQUISITION, success: 'Plan loaded. Review the rounds before you continue.', handled: false },
  );
  const copyPlan = useCommand(
    () => post(`/api/requisitions/${requisition.id}/plan/copy`, { fromId: Number(copyFrom) }),
    { refresh: REFRESH_REQUISITION, success: 'Plan copied. Review the rounds before you continue.' },
  );

  const err = (i, field) => errors[`rounds.${i}.${field}`] ?? (field === 'name' ? errors[`rounds.${i}.name`] : undefined);
  const otherRoles = (others.data ?? []).filter((r) => r.id !== requisition.id);

  return (
    <Section
      id="plan-heading"
      title={compact ? 'Interview rounds' : 'Hiring plan'}
      action={editable && (
        <div className="row-tools">
          <Field label="Start from">
            {(p) => (
              <Select {...p} value={pickTemplate} onChange={(e) => setPickTemplate(e.target.value)}>
                <option value="">Choose a plan</option>
                {(templates.data?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </Field>
          <Button disabled={!pickTemplate} onClick={() => setConfirmTemplate(true)}>Use this plan</Button>
        </div>
      )}
    >
      <p className="muted small">
        Each round is one step a candidate passes through, in order. Change the names, order, pass marks and the people involved to fit this role.
      </p>

      {editable && otherRoles.length > 0 && (
        <div className="row-tools subtle">
          <Field label="Or copy the rounds from another role">
            {(p) => (
              <Select {...p} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Choose a role</option>
                {otherRoles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            )}
          </Field>
          <Button disabled={!copyFrom || copyPlan.isPending} onClick={() => copyPlan.mutate()}>Copy rounds</Button>
        </div>
      )}

      {formError && <p role="alert" className="banner bad">{formError}</p>}

      <ol className="rounds">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className="round">
            <div className="round-head">
              <span className="round-num num">{i + 1}</span>
              <div className="round-title">
                {editable ? (
                  <Field label="Round name" error={err(i, 'name')}>
                    {(p) => <input {...p} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />}
                  </Field>
                ) : <strong>{r.name}</strong>}
              </div>
              {editable && (
                <div className="round-tools">
                  <MoveUp label={`Move ${r.name || 'round'} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <MoveDown label={`Move ${r.name || 'round'} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  <button type="button" className="icon-btn danger" aria-label={`Remove ${r.name || 'round'}`}
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {editable ? (
              <div className="round-grid">
                <Field label="What kind of round">
                  {(p) => (
                    <Select {...p} value={r.type} onChange={(e) => update(i, { ...blankRound(e.target.value), name: r.name, who: r.who, format: r.format, skills: r.skills, durationMin: r.durationMin, id: r.id })}>
                      {Object.entries(ROUND_TYPE_TEXT).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Who interviews" hint="For example, Senior Java developer">
                  {(p) => <input {...p} value={r.who ?? ''} onChange={(e) => update(i, { who: e.target.value })} />}
                </Field>
                <Field label="Minutes" error={err(i, 'durationMin')}>
                  {(p) => <input {...p} type="number" min="5" value={r.durationMin ?? ''} onChange={(e) => update(i, { durationMin: e.target.value })} />}
                </Field>
                {r.type === 'ONLINE_TEST' && (
                  <Field label="Pass mark (%)" error={err(i, 'passPercent')}>
                    {(p) => <input {...p} type="number" min="0" max="100" value={r.passPercent ?? ''} onChange={(e) => update(i, { passPercent: e.target.value })} />}
                  </Field>
                )}
                {(r.type === 'SCORECARD' || r.type === 'TAKE_HOME') && (
                  <Field label="Pass average (1 to 5)" error={err(i, 'passAverage')}>
                    {(p) => <input {...p} type="number" step="0.5" min="1" max="5" value={r.passAverage ?? ''} onChange={(e) => update(i, { passAverage: e.target.value })} />}
                  </Field>
                )}
                <Field label="Format" hint="Video call, test link, discussion">
                  {(p) => <input {...p} value={r.format ?? ''} onChange={(e) => update(i, { format: e.target.value })} />}
                </Field>
                <div className="span-2">
                  <Field label="What is checked">
                    {(p) => <ChipInput {...p} label="What is checked" value={r.skills ?? []} onChange={(skills) => update(i, { skills })} />}
                  </Field>
                </div>
                <label className="check">
                  <input type="checkbox" checked={!!r.optional} onChange={(e) => update(i, { optional: e.target.checked })} />
                  Optional round (can be skipped)
                </label>
              </div>
            ) : (
              <p className="muted small">
                {ROUND_TYPE_TEXT[r.type]}
                {r.type === 'ONLINE_TEST' && ` · pass at ${r.passPercent}%`}
                {(r.type === 'SCORECARD' || r.type === 'TAKE_HOME') && ` · pass at ${r.passAverage} average`}
                {r.who && ` · ${r.who}`}
                {r.skills?.length ? ` · ${r.skills.join(', ')}` : ''}
              </p>
            )}
          </li>
        ))}
      </ol>

      {editable && (
        <div className="row-tools">
          <Button onClick={() => setRows((rs) => [...rs, { ...blankRound(), name: `Round ${rs.length + 1}` }])}>
            <Plus size={16} aria-hidden="true" /> Add a round
          </Button>
          <Button variant="primary" disabled={busy || rows.length === 0} onClick={save}>
            {busy ? 'Saving…' : 'Save hiring plan'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmTemplate}
        title="Replace the rounds with this plan?"
        consequence="Rounds with the same name keep their history. Other rounds are removed, but only if no candidate has reached them yet."
        confirmLabel="Use this plan"
        onCancel={() => setConfirmTemplate(false)}
        onConfirm={() => {
          setConfirmTemplate(false);
          applyTemplate.mutate();
        }}
      />
    </Section>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { post, patch, ApiError } from '../../lib/api.js';
import { useRequisition, REFRESH_REQUISITION } from '../../lib/data.js';
import { useFormState, num, list } from '../../lib/forms.js';
import { Button, Field, PageHeader } from '../../components/ui.jsx';
import { ChipInput, Steps, Facts } from '../../components/kit.jsx';
import RoundsEditor from './RoundsEditor.jsx';
import ApproverPicker, { defaultSteps } from './ApproverPicker.jsx';
import { fmtDate, REQ_STATUS_TEXT } from '../../lib/format.js';

const STEPS = ['The role', 'Skills and experience', 'Hiring plan', 'Review and send'];

/** Four short steps: each one saves, so nothing is lost if the page is closed. */
export default function RequisitionWizard() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useRequisition(id);
  const [step, setStep] = useState(0);
  const [req, setReq] = useState(null);
  const [steps, setSteps] = useState(defaultSteps);
  const [approvalError, setApprovalError] = useState({});

  useEffect(() => { if (existing.data?.requisition) setReq(existing.data.requisition); }, [existing.data]);

  const role = useFormState({
    title: '', level: '', headcount: 1, team: '', location: '', remote: false,
    budgetMaxLpa: '', targetJoinDate: '',
  });
  const skills = useFormState({
    mustSkills: [], goodSkills: [], expMin: '', expMax: '', noticeMaxDays: '', jdText: '',
  });

  // Fill the forms from the saved role when editing.
  useEffect(() => {
    if (!req) return;
    role.reset({
      title: req.title, level: req.level ?? '', headcount: req.headcount, team: req.team ?? '', location: req.location ?? '',
      remote: req.remote, budgetMaxLpa: req.budgetMaxLpa ?? '', targetJoinDate: req.targetJoinDate ?? '',
    });
    skills.reset({
      mustSkills: req.mustSkills, goodSkills: req.goodSkills, expMin: req.expMin ?? '', expMax: req.expMax ?? '',
      noticeMaxDays: req.noticeMaxDays ?? '', jdText: req.jdText ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.id]);

  const roleBody = (v) => ({
    title: v.title.trim(), level: v.level || null, headcount: Number(v.headcount) || 1, team: v.team || null,
    location: v.location || null, remote: !!v.remote,
    budgetMaxLpa: num(v.budgetMaxLpa), targetJoinDate: v.targetJoinDate || null,
  });
  const skillBody = (v) => ({
    mustSkills: list(v.mustSkills), goodSkills: list(v.goodSkills), expMin: num(v.expMin), expMax: num(v.expMax),
    noticeMaxDays: num(v.noticeMaxDays), jdText: v.jdText || '',
  });

  async function saveRole() {
    return role.run(async (v) => {
      if (!req) {
        const res = await post('/api/requisitions', roleBody(v));
        return res.requisition;
      }
      const res = await patch(`/api/requisitions/${req.id}`, { version: req.version, ...roleBody(v) });
      return res.requisition;
    }, (r) => { setReq(r); setStep(1); qc.invalidateQueries({ queryKey: ['requisitions'] }); });
  }

  async function saveSkills() {
    return skills.run(async (v) => {
      const res = await patch(`/api/requisitions/${req.id}`, { version: req.version, ...skillBody(v) });
      return res.requisition;
    }, (r) => { setReq(r); setStep(2); });
  }

  async function sendForApproval() {
    setApprovalError({});
    try {
      const approvers = steps.map((s) => ({ label: s.label.trim(), approverId: Number(s.approverId) }));
      const res = await post(`/api/requisitions/${req.id}/submit`, { approvers: approvers.filter((a) => a.approverId) });
      REFRESH_REQUISITION.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success('Sent for approval. You will see each step here as it is decided.');
      navigate(`/requisitions/${res.requisition.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = { ...e.fields };
        setApprovalError(fields);
        toast.error(e.message);
      }
    }
  }

  const headerTitle = editing ? (req ? req.title : 'Edit role') : 'New requisition';
  const locked = req && !['DRAFT', 'REJECTED'].includes(req.status);

  return (
    <>
      <PageHeader
        title={headerTitle}
        lead={req ? `Status: ${REQ_STATUS_TEXT[req.status]}. Each step saves as you go.` : 'Start with the basics. You can change anything before it is sent for approval.'}
      />
      <Steps steps={STEPS} current={step} onJump={(i) => setStep(i)} />

      {locked && (
        <p role="status" className="banner accent">
          This role is {REQ_STATUS_TEXT[req.status].toLowerCase()}. Details are locked. Hold or close it to make changes.
        </p>
      )}

      {step === 0 && (
        <form className="panel stack" noValidate onSubmit={(e) => { e.preventDefault(); saveRole(); }}>
          <div className="form-grid">
            <Field label="Job title" error={role.errors.title} hint="For example, Java Developer">
              {(p) => <input {...p} {...role.bind('title')} autoFocus />}
            </Field>
            <Field label="Level" error={role.errors.level} hint="For example, SDE-2 or 3 to 5 years">
              {(p) => <input {...p} {...role.bind('level')} />}
            </Field>
            <Field label="How many people" error={role.errors.headcount}>
              {(p) => <input {...p} type="number" min="1" {...role.bind('headcount')} />}
            </Field>
            <Field label="Team" error={role.errors.team}>
              {(p) => <input {...p} {...role.bind('team')} />}
            </Field>
            <Field label="Location" error={role.errors.location}>
              {(p) => <input {...p} {...role.bind('location')} />}
            </Field>
            <label className="check align-end">
              <input type="checkbox" checked={!!role.values.remote} onChange={role.bind('remote').onChange} />
              Remote is allowed
            </label>
            <Field label="Most we can pay (LPA)" error={role.errors.budgetMaxLpa} hint="Lakhs per year, for example 28">
              {(p) => <input {...p} type="number" step="0.5" min="0" {...role.bind('budgetMaxLpa')} />}
            </Field>
            <Field label="Target joining date" error={role.errors.targetJoinDate}>
              {(p) => <input {...p} type="date" {...role.bind('targetJoinDate')} />}
            </Field>
          </div>
          {role.formError && <p role="alert" className="banner bad">{role.formError}</p>}
          <div className="form-foot">
            <Button variant="ghost" onClick={() => navigate(req ? `/requisitions/${req.id}` : '/requisitions')}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={role.busy || locked}>{role.busy ? 'Saving…' : 'Save and continue'}</Button>
          </div>
        </form>
      )}

      {step === 1 && req && (
        <form className="panel stack" noValidate onSubmit={(e) => { e.preventDefault(); saveSkills(); }}>
          <Field label="Must-have skills" error={skills.errors.mustSkills} hint="Resumes are scored on these first. Add one per entry.">
            {(p) => <ChipInput {...p} label="Must-have skills" value={skills.values.mustSkills} onChange={(v) => skills.set('mustSkills', v)} />}
          </Field>
          <Field label="Good-to-have skills" hint="Useful, but not required">
            {(p) => <ChipInput {...p} label="Good-to-have skills" value={skills.values.goodSkills} onChange={(v) => skills.set('goodSkills', v)} />}
          </Field>
          <div className="form-grid">
            <Field label="Experience from (years)" error={skills.errors.expMin}>
              {(p) => <input {...p} type="number" min="0" step="0.5" {...skills.bind('expMin')} />}
            </Field>
            <Field label="Experience up to (years)" error={skills.errors.expMax}>
              {(p) => <input {...p} type="number" min="0" step="0.5" {...skills.bind('expMax')} />}
            </Field>
            <Field label="Longest notice period we accept (days)" error={skills.errors.noticeMaxDays} hint="Longer needs manager approval">
              {(p) => <input {...p} type="number" min="0" {...skills.bind('noticeMaxDays')} />}
            </Field>
          </div>
          <Field label="Job description" error={skills.errors.jdText} hint="Shown to the hiring team. Optional at this stage.">
            {(p) => <textarea {...p} rows={6} {...skills.bind('jdText')} />}
          </Field>
          {skills.formError && <p role="alert" className="banner bad">{skills.formError}</p>}
          <div className="form-foot">
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" type="submit" disabled={skills.busy || locked}>{skills.busy ? 'Saving…' : 'Save and continue'}</Button>
          </div>
        </form>
      )}

      {step === 2 && req && (
        <div className="stack">
          <RoundsEditor requisition={req} editable={!locked} onSaved={(r) => { setReq(r); toast.success('Hiring plan saved.'); }} />
          <div className="form-foot">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(3)}>Continue to review</Button>
          </div>
        </div>
      )}

      {step === 3 && req && (
        <div className="stack">
          <section className="panel stack">
            <h2>Check before sending</h2>
            <Facts items={[
              { label: 'Role', value: `${req.title}${req.level ? ` · ${req.level}` : ''}` },
              { label: 'Headcount', value: req.headcount },
              { label: 'Location', value: req.remote ? 'Remote allowed' : req.location || '—' },
              { label: 'Most we can pay', value: req.budgetMaxLpa ? `${req.budgetMaxLpa} LPA` : 'Not set' },
              { label: 'Target joining', value: fmtDate(req.targetJoinDate) || 'Not set' },
              { label: 'Must-have skills', value: req.mustSkills.join(', ') || 'None yet' },
              { label: 'Interview rounds', value: `${req.rounds.length} rounds` },
            ]} />
            {(!req.mustSkills.length || !req.budgetMaxLpa || !req.targetJoinDate || !req.rounds.length) && (
              <p className="banner bad" role="alert">
                Before it can be sent: {[
                  !req.mustSkills.length && 'add a must-have skill',
                  !req.budgetMaxLpa && 'set the budget',
                  !req.targetJoinDate && 'set the target joining date',
                  !req.rounds.length && 'add a hiring plan',
                ].filter(Boolean).join(', ')}.
              </p>
            )}
          </section>

          <section className="panel stack" aria-labelledby="approvers-title">
            <h2 id="approvers-title">Who approves, in order</h2>
            <p className="muted small">Each step must approve before the next person is asked. Once all approve, the role opens for applications.</p>
            <ApproverPicker steps={steps} onChange={setSteps} errors={approvalError} />
          </section>

          <div className="form-foot">
            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" onClick={sendForApproval} disabled={locked}>Send for approval</Button>
          </div>
        </div>
      )}
    </>
  );
}

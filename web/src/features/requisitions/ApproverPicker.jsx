import { Plus, Trash2 } from 'lucide-react';
import { useApprovers } from '../../lib/data.js';
import { Button, Field } from '../../components/ui.jsx';
import { Select } from '../../components/Select.jsx';

const DEFAULT_STEPS = [
  { label: 'HR: budget and headcount', approverId: '' },
  { label: 'Finance', approverId: '' },
  { label: 'Department head', approverId: '' },
];

export { DEFAULT_STEPS };

/** Chooses who approves the role, in order. Each step has a plain label and one named person. */
export default function ApproverPicker({ steps, onChange, errors = {} }) {
  const approvers = useApprovers();
  const people = approvers.data?.approvers ?? [];
  const update = (i, patch) => onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <div className="stack">
      {steps.map((s, i) => (
        <div key={i} className="approver-row">
          <Field label={`Step ${i + 1}: what they check`} error={errors[`approvers.${i}.label`]}>
            {(p) => <input {...p} value={s.label} onChange={(e) => update(i, { label: e.target.value })} />}
          </Field>
          <Field label="Who approves" error={errors.approvers}>
            {(p) => (
              <Select {...p} value={s.approverId} onChange={(e) => update(i, { approverId: e.target.value })}>
                <option value="">Choose a person</option>
                {people.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role === 'HR' ? 'HR' : u.role === 'ADMIN' ? 'Admin' : 'Recruiter'})</option>)}
              </Select>
            )}
          </Field>
          <button type="button" className="icon-btn danger" aria-label={`Remove step ${i + 1}`}
            disabled={steps.length === 1} onClick={() => onChange(steps.filter((_, idx) => idx !== i))}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div>
        <Button onClick={() => onChange([...steps, { label: '', approverId: '' }])}>
          <Plus size={16} aria-hidden="true" /> Add a step
        </Button>
      </div>
    </div>
  );
}

export const defaultSteps = () => DEFAULT_STEPS.map((s) => ({ ...s }));

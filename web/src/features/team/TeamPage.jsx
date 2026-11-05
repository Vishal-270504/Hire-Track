import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { get, post, patch, applyFieldErrors } from '../../lib/api.js';
import { ROLE_LABEL, ROLE_OPTIONS } from '../../lib/labels.js';
import { Button, Dialog, ConfirmDialog, Field, Pill, PageHeader, DataTable } from '../../components/ui.jsx';
import { Select } from '../../components/Select.jsx';

const addSchema = z.object({
  name: z.string().trim().min(2, 'Enter a full name.'),
  email: z.string().trim().email('Enter a valid work email.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
  role: z.enum(['HR', 'RECRUITER', 'INTERVIEWER', 'IT', 'ADMIN'], { errorMap: () => ({ message: 'Choose a role.' }) }),
});

export default function TeamPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(null); // { user, next: 'deactivate' | 'activate' }
  const users = useQuery({ queryKey: ['users'], queryFn: () => get('/api/users').then((d) => d.users) });

  const update = useMutation({
    mutationFn: ({ id, body }) => patch(`/api/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const columns = [
    { key: 'name', header: 'Name', render: (u) => <span className="strong">{u.name}</span> },
    { key: 'email', header: 'Email', render: (u) => <span className="muted">{u.email}</span> },
    {
      key: 'role',
      header: 'Role',
      render: (u) => (
        <Select
          aria-label={`Role for ${u.name}`}
          value={u.role}
          onChange={(e) => update.mutate(
            { id: u.id, body: { role: e.target.value } },
            {
              onSuccess: () => toast.success(`${u.name} is now ${ROLE_LABEL[e.target.value]}.`),
              onError: (err) => toast.error(err.message),
            },
          )}
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ),
    },
    {
      key: 'status',
      header: 'Access',
      render: (u) => (u.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Off</Pill>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <Button variant="ghost" onClick={() => setPending({ user: u, next: u.active ? 'deactivate' : 'activate' })}>
          {u.active ? 'Turn off access' : 'Turn on access'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        lead="Everyone who signs in to HireTrack. Each role sees only what its work needs."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" /> Add person</Button>}
      />
      <DataTable
        columns={columns}
        rows={users.data}
        loading={users.isPending}
        error={users.error?.message}
        onRetry={() => users.refetch()}
        rowKey={(u) => u.id}
        empty={{ title: 'No one here yet', body: 'Add the first person to get started.' }}
      />

      <AddPersonDialog open={adding} onClose={() => setAdding(false)} />

      <ConfirmDialog
        open={!!pending}
        title={pending?.next === 'deactivate' ? `Turn off access for ${pending?.user.name}?` : `Turn on access for ${pending?.user.name}?`}
        consequence={pending?.next === 'deactivate'
          ? 'They will be signed out and cannot sign in until you turn access back on. Their past notes and feedback stay in place.'
          : 'They will be able to sign in again with their existing password.'}
        confirmLabel={pending?.next === 'deactivate' ? 'Turn off access' : 'Turn on access'}
        tone={pending?.next === 'deactivate' ? 'danger' : 'primary'}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const { user, next } = pending;
          setPending(null);
          update.mutate(
            { id: user.id, body: { active: next === 'activate' } },
            {
              onSuccess: () => toast.success(next === 'activate' ? `${user.name} can sign in again.` : `${user.name} is signed out.`),
              onError: (err) => toast.error(err.message),
            },
          );
        }}
      />
    </>
  );
}

function AddPersonDialog({ open, onClose }) {
  const qc = useQueryClient();
  const { register, handleSubmit, setError, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(addSchema),
    defaultValues: { name: '', email: '', password: '', role: 'RECRUITER' },
  });

  const create = useMutation({ mutationFn: (body) => post('/api/users', body) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { user } = await create.mutateAsync(values);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${user.name} has been added as ${ROLE_LABEL[user.role]}.`);
      reset();
      onClose();
    } catch (err) {
      applyFieldErrors(setError, err);
      if (!Object.keys(err.fields ?? {}).length) toast.error(err.message);
    }
  });

  return (
    <Dialog
      open={open}
      title="Add a person"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-person" disabled={isSubmitting}>Add person</Button>
        </>
      }
    >
      <form id="add-person" onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Full name" error={errors.name?.message}>
          {(p) => <input {...register('name')} {...p} />}
        </Field>
        <Field label="Work email" error={errors.email?.message}>
          {(p) => <input type="email" {...register('email')} {...p} />}
        </Field>
        <Field label="Role" error={errors.role?.message} hint="Interviewers see only the candidates they are on the panel for.">
          {(p) => (
            <Select {...p} value={watch('role')} onChange={(e) => setValue('role', e.target.value)}>
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Starting password" error={errors.password?.message} hint="At least 10 characters. Share it with them in person.">
          {(p) => <input type="text" autoComplete="new-password" {...register('password')} {...p} />}
        </Field>
      </form>
    </Dialog>
  );
}

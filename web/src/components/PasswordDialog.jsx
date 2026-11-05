import { useState } from 'react';
import { post, ApiError } from '../lib/api.js';
import { toast } from 'sonner';
import { Dialog, Button, Field } from './ui.jsx';

/** Change your own password. Every other sign-in is ended, so you sign in again with the new one. */
export function PasswordDialog({ open, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again && again !== next;
  async function save() {
    setErrors({}); setMessage('');
    if (mismatch) return setErrors({ again: 'The two new passwords do not match.' });
    setBusy(true);
    try {
      await post('/api/auth/password', { current, next });
      toast.success('Password changed. Please sign in again.');
      setTimeout(() => window.location.assign('/login'), 600);
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fields ?? {}); setMessage(e.message); }
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} title="Change password" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || next.length < 10 || !current} onClick={save}>Change password</Button></>}>
      <div className="stack">
        <Field label="Current password" error={errors.current}>{(p) => <input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="New password" error={errors.next} hint="At least 10 characters">{(p) => <input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Field label="New password again" error={errors.again}>{(p) => <input {...p} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>
        {message && <p role="alert" className="banner bad">{message}</p>}
      </div>
    </Dialog>
  );
}

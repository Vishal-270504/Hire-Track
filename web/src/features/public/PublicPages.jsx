import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, MapPin, Briefcase } from 'lucide-react';
import { get, post, ApiError } from '../../lib/api.js';
import { useFormState, num } from '../../lib/forms.js';
import { Button, Field, Pill, EmptyState, Skeleton } from '../../components/ui.jsx';
import { ChipInput, Section } from '../../components/kit.jsx';
import { BrandMark } from '../../components/Brand.jsx';
import { fmtDate } from '../../lib/format.js';

/** Layout for pages anyone can open. No sign-in, no navigation to the internal tracker. */
export function PublicShell({ children }) {
  return (
    <div className="public">
      <header className="public-top">
        <Link to="/careers" className="public-brand" aria-label="HireTrack careers"><BrandMark /></Link>
      </header>
      <main className="public-main">{children}</main>
    </div>
  );
}

export function CareersPage() {
  const roles = useQuery({ queryKey: ['careers'], queryFn: () => get('/api/careers').then((d) => d.roles) });
  return (
    <PublicShell>
      <header className="public-head">
        <h1>Open roles</h1>
        <p className="muted lead">Tell us about yourself. We read every application, and you will hear back on the status page we give you.</p>
      </header>
      {roles.isPending && <Skeleton rows={3} />}
      {roles.error && <div role="alert" className="banner bad">{roles.error.message}</div>}
      {roles.data && roles.data.length === 0 && <EmptyState title="No roles are open right now">Check back soon.</EmptyState>}
      <ul className="role-list">
        {(roles.data ?? []).map((r) => (
          <li key={r.id} className="role-item">
            <div>
              <Link to={`/careers/${r.id}`} className="role-title">{r.title}{r.level ? ` · ${r.level}` : ''}</Link>
              <div className="muted small role-meta">
                <MapPin size={14} aria-hidden="true" /> {r.remote ? 'Remote allowed' : r.location || 'Location to be confirmed'}
                {r.expMin != null && <> · <Briefcase size={14} aria-hidden="true" /> {r.expMin} to {r.expMax} years</>}
              </div>
              <div className="small role-skills">{r.mustSkills.slice(0, 5).join(' · ')}</div>
            </div>
            <Link to={`/careers/${r.id}`} className="btn btn-primary">View and apply</Link>
          </li>
        ))}
      </ul>
    </PublicShell>
  );
}

export function RoleApplyPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const role = useQuery({ queryKey: ['career', id], queryFn: () => get(`/api/careers/${id}`).then((d) => d.role) });
  const f = useFormState({ name: '', email: '', phone: '', experienceYears: '', noticeDays: '', location: '', resumeText: '', consent: false });
  const [hint, setHint] = useState('');
  const [sent, setSent] = useState(null);

  async function upload(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/careers/parse-resume', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data);
      f.set('resumeText', data.text);
      setHint(data.hint ?? 'Resume read. Check the text, then send.');
    } catch (e) { setHint(e.message); }
  }

  async function submit(e) {
    e.preventDefault();
    f.setErrors({});
    f.setFormError('');
    try {
      const res = await post(`/api/careers/${id}/apply`, {
        name: f.values.name, email: f.values.email, phone: f.values.phone,
        experienceYears: num(f.values.experienceYears), noticeDays: num(f.values.noticeDays),
        location: f.values.location, resumeText: f.values.resumeText, consent: f.values.consent,
      });
      setSent(res);
      qc.invalidateQueries({ queryKey: ['careers'] });
    } catch (err) {
      f.setErrors(err instanceof ApiError ? err.fields ?? {} : {});
      f.setFormError(err.message);
    }
  }

  if (sent) {
    return (
      <PublicShell>
        <section className="panel stack" aria-live="polite">
          <h1>Thank you for applying</h1>
          {sent.statusUrl ? (
            <>
              <p>Keep this link to follow your application. It works on any device.</p>
              <p><Link to={sent.statusUrl} className="btn btn-primary">Open my status page</Link></p>
              <p className="muted small">Please save it now. We will not email it to you again.</p>
            </>
          ) : (
            <p>We have received your details. We will be in touch soon.</p>
          )}
        </section>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      {role.isPending && <Skeleton rows={4} />}
      {role.error && <div role="alert" className="banner bad">{role.error.message} <Link to="/careers">Back to open roles</Link></div>}
      {role.data && (
        <>
          <header className="public-head">
            <p className="eyebrow">Apply</p>
            <h1>{role.data.title}{role.data.level ? ` · ${role.data.level}` : ''}</h1>
            <p className="muted small">{role.data.remote ? 'Remote allowed' : role.data.location}{role.data.expMin != null ? ` · ${role.data.expMin} to ${role.data.expMax} years` : ''}</p>
          </header>
          {role.data.jdText && <Section id="jd" title="About the role"><p className="pre">{role.data.jdText}</p></Section>}
          <form className="panel stack" noValidate onSubmit={submit}>
            <div className="form-grid">
              <Field label="Full name" error={f.errors.name}>{(p) => <input {...p} {...f.bind('name')} autoComplete="name" />}</Field>
              <Field label="Email" error={f.errors.email} hint="Email or phone is needed">{(p) => <input {...p} type="email" autoComplete="email" {...f.bind('email')} />}</Field>
              <Field label="Phone" error={f.errors.phone}>{(p) => <input {...p} type="tel" autoComplete="tel" {...f.bind('phone')} />}</Field>
              <Field label="Where you live" error={f.errors.location}>{(p) => <input {...p} {...f.bind('location')} />}</Field>
              <Field label="Years of experience" error={f.errors.experienceYears}>{(p) => <input {...p} type="number" step="0.5" min="0" {...f.bind('experienceYears')} />}</Field>
              <Field label="Notice period (days)" error={f.errors.noticeDays}>{(p) => <input {...p} type="number" min="0" {...f.bind('noticeDays')} />}</Field>
            </div>
            <div className="upload">
              <label className="btn btn-secondary upload-btn"><Upload size={16} aria-hidden="true" /> Upload your resume
                <input type="file" accept=".pdf,.docx,.txt" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label>
              <span className="muted small">PDF, Word or text, up to 5 MB. Or paste it below.</span>
            </div>
            {hint && <p role="status" className="banner accent">{hint}</p>}
            <Field label="Resume text" error={f.errors.resumeText}>{(p) => <textarea {...p} rows={8} {...f.bind('resumeText')} />}</Field>
            <label className="check">
              <input type="checkbox" checked={!!f.values.consent} onChange={f.bind('consent').onChange} />
              I agree that HireTrack may store my details and resume to consider me for this role. I can ask for them to be removed at any time.
            </label>
            {f.errors.consent && <p className="field-msg bad">{f.errors.consent}</p>}
            {f.formError && <p role="alert" className="banner bad">{f.formError}</p>}
            <div className="form-foot"><Button variant="primary" type="submit" disabled={f.busy}>Send my application</Button></div>
          </form>
          <p className="muted small mt"><Link to="/careers">Back to all roles</Link></p>
        </>
      )}
    </PublicShell>
  );
}

/** The candidate's own page, opened from the private link. Documents and the offer reply live here. */
export function StatusPage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['portal', token], queryFn: () => get(`/api/portal/${token}`), retry: false });
  const [busy, setBusy] = useState(false);
  const [signName, setSignName] = useState('');
  const [note, setNote] = useState('');
  const refresh = (data) => qc.setQueryData(['portal', token], data);

  async function upload(doc, file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${token}/documents/${doc.id}`, { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data);
      refresh(data);
      toast.success(`${doc.docType} received. Thank you.`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function respond(decision) {
    setBusy(true);
    try {
      const data = await post(`/api/portal/${token}/respond`, { decision, signName, note });
      refresh(data);
      toast.success(decision === 'ACCEPT' ? 'Thank you. Welcome aboard.' : 'Thank you for letting us know.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <PublicShell>
      {status.isPending && <Skeleton rows={4} />}
      {status.error && <EmptyState title="This link is not valid">{status.error.message}</EmptyState>}
      {status.data && (
        <div className="stack-lg">
          <header className="public-head">
            <p className="eyebrow">Hello {status.data.firstName}</p>
            <h1>{status.data.role}</h1>
            <p className="lead">{status.data.message}</p>
            <Pill tone="accent">{status.data.stageLabel}</Pill>
          </header>

          {status.data.offer && ['SENT', 'NEGOTIATING'].includes(status.data.offer.status) && (
            <Section id="offer" title="Your offer">
              <dl className="facts">
                <div className="fact"><dt>Salary</dt><dd>{status.data.offer.ctcLpa} LPA</dd></div>
                <div className="fact"><dt>Joining</dt><dd>{fmtDate(status.data.offer.joinDate)}</dd></div>
                <div className="fact"><dt>Please reply by</dt><dd>{fmtDate(status.data.offer.expiryDate)}</dd></div>
              </dl>
              <pre className="pre letter mt">{status.data.offer.letter}</pre>
              <div className="panel stack mt">
                <Field label="Type your full name to accept (this is your signature)">
                  {(p) => <input {...p} value={signName} onChange={(e) => setSignName(e.target.value)} />}
                </Field>
                <Field label="Note (for a question, a change you would like, or a reason)">
                  {(p) => <textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <div className="round-actions">
                  <Button variant="primary" disabled={busy || signName.trim().length < 3} onClick={() => respond('ACCEPT')}>Accept and sign</Button>
                  <Button disabled={busy || note.trim().length < 3} onClick={() => respond('NEGOTIATE')}>I would like to discuss</Button>
                  <Button variant="ghost" disabled={busy || note.trim().length < 3} onClick={() => respond('DECLINE')}>I am declining</Button>
                </div>
              </div>
            </Section>
          )}

          {status.data.documents.length > 0 && (
            <Section id="docs" title="Documents to upload">
              <p className="muted small">{status.data.documentsNote}</p>
              <ul className="doc-list">
                {status.data.documents.map((d) => (
                  <li key={d.id} className="doc-row">
                    <div className="doc-main">
                      <strong>{d.docType}</strong>
                      <Pill tone={d.status === 'VERIFIED' ? 'ok' : d.status === 'REJECTED' ? 'bad' : d.status === 'SUBMITTED' ? 'accent' : 'neutral'}>
                        {d.status === 'VERIFIED' ? 'Checked' : d.status === 'REJECTED' ? 'Please upload again' : d.status === 'SUBMITTED' ? 'Received' : d.status === 'LATER' ? 'To follow' : 'Not uploaded'}
                      </Pill>
                    </div>
                    {d.reason && <p className="small bad-text">{d.reason}</p>}
                    {d.status !== 'VERIFIED' && (
                      <label className="btn btn-secondary upload-btn">
                        {d.hasFile ? 'Upload a new copy' : 'Upload'}
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="sr-only" disabled={busy} onChange={(e) => upload(d, e.target.files?.[0])} />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </PublicShell>
  );
}

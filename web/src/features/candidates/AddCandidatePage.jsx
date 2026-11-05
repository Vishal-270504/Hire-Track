import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { post, ApiError } from '../../lib/api.js';
import { useRequisitions, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { useFormState, num } from '../../lib/forms.js';
import { SOURCES } from '../../lib/format.js';
import { Button, Dialog, Field, PageHeader } from '../../components/ui.jsx';
import { Select } from '../../components/Select.jsx';

/**
 * Add a candidate. Upload a resume (PDF, Word or text) or paste the text, then the form does the rest:
 * it scores the resume, checks for duplicates, and flags anything that needs a look.
 */
export default function AddCandidatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const roles = useRequisitions('OPEN');
  const [uploadHint, setUploadHint] = useState('');
  const [duplicates, setDuplicates] = useState(null);
  const f = useFormState({
    requisitionId: params.get('role') ?? '', name: '', email: '', phone: '', location: '', source: 'LinkedIn',
    sourceDetail: '', experienceYears: '', currentCtcLpa: '', expectedCtcLpa: '', noticeDays: '',
    workAuth: '', shiftOk: '', resumeText: '', portfolioUrl: '', githubUrl: '', pan: '',
  });

  const tri = (v) => (v === '' ? null : v === 'true');

  const body = (extra = {}) => ({
    requisitionId: Number(f.values.requisitionId),
    name: f.values.name.trim(),
    email: f.values.email.trim(),
    phone: f.values.phone.trim(),
    pan: f.values.pan.trim().toUpperCase(),
    location: f.values.location.trim(),
    source: f.values.source,
    sourceDetail: f.values.sourceDetail.trim(),
    experienceYears: num(f.values.experienceYears),
    currentCtcLpa: num(f.values.currentCtcLpa),
    expectedCtcLpa: num(f.values.expectedCtcLpa),
    noticeDays: num(f.values.noticeDays),
    workAuth: tri(f.values.workAuth),
    shiftOk: tri(f.values.shiftOk),
    resumeText: f.values.resumeText,
    portfolioUrl: f.values.portfolioUrl.trim(),
    githubUrl: f.values.githubUrl.trim(),
    ...extra,
  });

  async function upload(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/candidates/parse-resume', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new ApiError(res.status, data);
      f.set('resumeText', data.text);
      setUploadHint(data.hint ?? 'Resume read. Check the text below, then save.');
    } catch (e) {
      setUploadHint(e.message);
    }
  }

  async function save(confirmDuplicate = false) {
    f.setFormError('');
    try {
      const res = await post('/api/candidates', body({ confirmDuplicate }));
      REFRESH_ALL_CANDIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast.success(`${res.candidate.name} added. Screening score ${Math.round(res.candidate.atsScore)}.`);
      navigate(`/candidates/${res.candidate.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_warning') {
        setDuplicates(e.details?.duplicates ?? []);
        return;
      }
      // Field problems show next to their inputs; anything else goes to the banner.
      f.setErrors(e instanceof ApiError ? e.fields ?? {} : {});
      f.setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <>
      <PageHeader title="Add a candidate" lead="Start with the role and a way to reach them. The resume is optional, but it gives a score." />
      <form
        className="stack-lg"
        noValidate
        onSubmit={(e) => { e.preventDefault(); save(false); }}
      >
        <section className="panel stack" aria-labelledby="who">
          <h2 id="who">Who and what for</h2>
          <div className="form-grid">
            <Field label="Role they applied for" error={f.errors.requisitionId}>
              {(p) => (
                <Select {...p} {...f.bind('requisitionId')} autoFocus>
                  <option value="">Choose an open role</option>
                  {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.level ? ` · ${r.level}` : ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Full name" error={f.errors.name}>{(p) => <input {...p} {...f.bind('name')} />}</Field>
            <Field label="Email" error={f.errors.email}>{(p) => <input {...p} type="email" {...f.bind('email')} />}</Field>
            <Field label="Phone" error={f.errors.phone} hint="Email or a 10-digit phone is needed">{(p) => <input {...p} type="tel" {...f.bind('phone')} />}</Field>
            <Field label="Location" error={f.errors.location}>{(p) => <input {...p} {...f.bind('location')} />}</Field>
            <Field label="Where did they come from?" error={f.errors.source}>
              {(p) => (
                <Select {...p} {...f.bind('source')}>
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Who referred them? (optional)" error={f.errors.sourceDetail}>{(p) => <input {...p} {...f.bind('sourceDetail')} />}</Field>
          </div>
        </section>

        <section className="panel stack" aria-labelledby="resume">
          <h2 id="resume">Resume</h2>
          <div className="upload">
            <label className="btn btn-secondary upload-btn">
              <Upload size={16} aria-hidden="true" /> Upload a resume
              <input type="file" accept=".pdf,.docx,.txt" className="sr-only"
                onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            <span className="muted small">PDF, Word or text, up to 5 MB. Or paste the text below.</span>
          </div>
          {uploadHint && <p role="status" className="banner accent">{uploadHint}</p>}
          <Field label="Resume text" error={f.errors.resumeText}>
            {(p) => <textarea {...p} rows={10} {...f.bind('resumeText')} />}
          </Field>
        </section>

        <section className="panel stack" aria-labelledby="details">
          <h2 id="details">Details for screening</h2>
          <div className="form-grid">
            <Field label="Years of experience" error={f.errors.experienceYears}>{(p) => <input {...p} type="number" step="0.5" min="0" {...f.bind('experienceYears')} />}</Field>
            <Field label="Notice period (days)" error={f.errors.noticeDays}>{(p) => <input {...p} type="number" min="0" {...f.bind('noticeDays')} />}</Field>
            <Field label="Expected salary (LPA)" error={f.errors.expectedCtcLpa}>{(p) => <input {...p} type="number" step="0.5" min="0" {...f.bind('expectedCtcLpa')} />}</Field>
            <Field label="Current salary (LPA)" error={f.errors.currentCtcLpa}>{(p) => <input {...p} type="number" step="0.5" min="0" {...f.bind('currentCtcLpa')} />}</Field>
            <Field label="Can work here legally?" error={f.errors.workAuth}>
              {(p) => <Select {...p} {...f.bind('workAuth')}><option value="">Not asked yet</option><option value="true">Yes</option><option value="false">No</option></Select>}
            </Field>
            <Field label="Available for the shift?" error={f.errors.shiftOk}>
              {(p) => <Select {...p} {...f.bind('shiftOk')}><option value="">Not asked yet</option><option value="true">Yes</option><option value="false">No</option></Select>}
            </Field>
            <Field label="PAN (optional)" error={f.errors.pan} hint="Used to spot the same person across applications">{(p) => <input {...p} {...f.bind('pan')} />}</Field>
            <Field label="Portfolio or LinkedIn" error={f.errors.portfolioUrl}>{(p) => <input {...p} {...f.bind('portfolioUrl')} />}</Field>
            <Field label="GitHub" error={f.errors.githubUrl}>{(p) => <input {...p} {...f.bind('githubUrl')} />}</Field>
          </div>
        </section>

        {f.formError && <p role="alert" className="banner bad">{f.formError}</p>}
        <div className="form-foot">
          <Button variant="ghost" onClick={() => navigate('/candidates')}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={f.busy}>Save candidate</Button>
        </div>
      </form>

      <Dialog
        open={!!duplicates}
        title="This person may already be in HireTrack"
        onClose={() => setDuplicates(null)}
        footer={
          <>
            <Button onClick={() => setDuplicates(null)}>Go back and check</Button>
            <Button variant="primary" onClick={() => { setDuplicates(null); save(true); }}>Add as a new application</Button>
          </>
        }
      >
        <p>Someone with the same email, phone or PAN is already here:</p>
        <ul className="flags">
          {(duplicates ?? []).map((d) => (
            <li key={d.id}><a href={`/candidates/${d.id}`}>{d.name}</a> · {d.requisitionTitle} · {d.status}</li>
          ))}
        </ul>
        <p className="muted small mt">If it is the same person applying for a different role, add them as a new application. It is linked to the earlier record.</p>
      </Dialog>
    </>
  );
}


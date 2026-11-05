import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api.js';
import { useLogin, useMe } from '../../lib/auth.js';
import { ROLE_LABEL } from '../../lib/labels.js';
import { Button, Field } from '../../components/ui.jsx';
import { ChevronDown } from 'lucide-react';
import { BrandMark } from '../../components/Brand.jsx';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter the email you were given.'),
  password: z.string().min(1, 'Enter your password.'),
});

export default function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState('');
  const [showDemo, setShowDemo] = useState(false);
  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => get('/api/auth/demo-accounts'),
    staleTime: Infinity,
  });
  const { register, handleSubmit, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (me.data) return <Navigate to={location.state?.from ?? '/'} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      await login.mutateAsync(values);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setFormError(err.message);
    }
  });

  const accounts = demo.data?.accounts ?? [];

  return (
    <div className="login">
      <section className="login-card" aria-labelledby="login-title">
        <BrandMark />
        <h1 id="login-title">Sign in to HireTrack</h1>
        <p className="muted">Use the work email your admin set up for you.</p>

        <form onSubmit={onSubmit} noValidate className="stack" aria-describedby={formError ? 'login-error' : undefined}>
          <Field label="Work email" error={errors.email?.message}>
            {(p) => <input type="email" autoComplete="username" autoFocus {...register('email')} {...p} />}
          </Field>
          <Field label="Password" error={errors.password?.message}>
            {(p) => <input type="password" autoComplete="current-password" {...register('password')} {...p} />}
          </Field>
          {formError && <p id="login-error" role="alert" className="banner bad">{formError}</p>}
          <Button variant="primary" type="submit" disabled={login.isPending} className="block">
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {accounts.length > 0 && (
          <div className="demo">
            <button type="button" className="disclosure" aria-expanded={showDemo} aria-controls="demo-panel" onClick={() => setShowDemo((v) => !v)}>
              <span>Try a demo role <span className="muted small">(development only)</span></span>
              <ChevronDown size={18} aria-hidden="true" className={showDemo ? 'chev chev-open' : 'chev'} />
            </button>
          {showDemo && (
          <div id="demo-panel" className="demo-body">
            <p className="muted small">Demo password: <code>hiretrack-demo</code></p>
            <ul className="demo-list">
              {accounts.map((a) => (
                <li key={a.email}>
                  <button type="button" className="demo-item" onClick={() => {
                    setValue('email', a.email);
                    setValue('password', 'hiretrack-demo');
                  }}>
                    <span>{a.name}</span>
                    <span className="muted">{ROLE_LABEL[a.role]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}
          </div>
        )}
      </section>
    </div>
  );
}

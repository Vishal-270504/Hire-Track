import { useState } from 'react';
import { ApiError } from './api.js';

/**
 * Small form state for dialogs and pages. Server field errors land next to their inputs;
 * a message with no field goes to the form-level banner.
 */
export function useFormState(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const bind = (key) => ({
    value: values[key] ?? '',
    onChange: (e) => {
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setValues((s) => ({ ...s, [key]: v }));
    },
  });
  const set = (key, v) => setValues((s) => ({ ...s, [key]: v }));

  async function run(fn, onDone) {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const result = await fn(values);
      onDone?.(result);
      return result;
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields ?? {}).length) setErrors(e.fields);
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const reset = (next = initial) => {
    setValues(next);
    setErrors({});
    setFormError('');
  };

  return { values, setValues, set, bind, errors, setErrors, formError, setFormError, busy, run, reset };
}

export const num = (v) => (v === '' || v == null ? null : Number(v));
export const list = (v) => (Array.isArray(v) ? v : []);

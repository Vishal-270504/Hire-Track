/*
 * The shared UI kit. Every screen uses these; no page builds its own buttons, pills, tables or dialogs.
 */
import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

const TONES = {
  neutral: ['var(--sunk)', 'var(--ink-2)'],
  accent: ['var(--accent-soft)', 'var(--accent)'],
  ok: ['var(--ok-soft)', 'var(--ok)'],
  warn: ['var(--warn-soft)', 'var(--warn)'],
  bad: ['var(--bad-soft)', 'var(--bad)'],
  info: ['var(--info-soft)', 'var(--info)'],
};

/** Status label. Always shows words, so colour is never the only signal. */
export function Pill({ tone = 'neutral', children }) {
  const [bg, fg] = TONES[tone] ?? TONES.neutral;
  return <span className="pill" style={{ background: bg, color: fg }}>{children}</span>;
}

export function Button({ variant = 'secondary', type = 'button', className = '', ...rest }) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...rest} />;
}

export function PageHeader({ title, lead, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead && <p className="muted lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Labelled field. `error` shows under the input; `hint` shows when there is no error. */
export function Field({ label, hint, error, children }) {
  const id = useId();
  const a11y = { id, 'aria-describedby': `${id}-msg`, 'aria-invalid': !!error };
  const control = typeof children === 'function' ? children(a11y) : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {error
        ? <p id={`${id}-msg`} className="field-msg bad">{error}</p>
        : hint ? <p id={`${id}-msg`} className="field-msg muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="skeletons">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

/**
 * Table that collapses to labelled stacked rows on phones.
 * Loading, error (with Retry) and empty states are built in, so no page reinvents them.
 */
export function DataTable({ columns, rows, rowKey, loading, error, onRetry, empty, onRowClick }) {
  if (loading) return <Skeleton rows={5} />;
  if (error) {
    return (
      <div role="alert" className="banner bad">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{error}</span>
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
      </div>
    );
  }
  if (!rows?.length) return <EmptyState title={empty?.title}>{empty?.body}</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" style={{ textAlign: c.align ?? 'left' }}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? 'clickable' : undefined}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.header} style={{ textAlign: c.align ?? 'left' }}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Native <dialog>: focus trap, Esc to close, sits above everything without clipping. */
export function Dialog({ open, title, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      // jsdom and very old browsers lack showModal; fall back to the open attribute.
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}

/** Confirm before anything that reaches a candidate or changes money, access or status. */
export function ConfirmDialog({ open, title, consequence, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onCancel }) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p>{consequence}</p>
    </Dialog>
  );
}

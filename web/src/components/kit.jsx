import { useState, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { X, Check, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { Pill } from './ui.jsx';

/** Tabs with real keyboard and screen-reader support, styled to match the app. */
export function TabBar({ value, onValueChange, items, children }) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className="tabs">
      <Tabs.List className="tab-list" aria-label="Sections">
        {items.map((it) => (
          <Tabs.Trigger key={it.value} value={it.value} className="tab-trigger">
            {it.label}{it.count != null && <span className="tab-count">{it.count}</span>}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
export const TabPanel = Tabs.Content;

/** The ⋯ menu for less common actions, so the page keeps one obvious primary button. */
export function ActionMenu({ label = 'More actions', items }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="btn btn-secondary" aria-label={label}>More</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={6}>
          {items.filter(Boolean).map((it) => (
            <Menu.Item
              key={it.label}
              className={`menu-item ${it.tone === 'danger' ? 'danger' : ''}`}
              disabled={it.disabled}
              onSelect={it.onSelect}
            >
              {it.icon && <it.icon size={16} aria-hidden="true" />} {it.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Tag-style list for skills: type and press Enter, or comma. */
export function ChipInput({ label, value = [], onChange, placeholder = 'Type and press Enter', id }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className="chip-input">
      <div className="chips" role="list">
        {value.map((c) => (
          <span key={c} className="chip" role="listitem">
            {c}
            <button type="button" className="chip-x" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

/** Step indicator for the requisition wizard. Completed steps are clickable. */
export function Steps({ steps, current, onJump }) {
  return (
    <ol className="steps" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className={`step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <button type="button" className="step-btn" disabled={state === 'todo'} onClick={() => onJump?.(i)}>
              <span className="step-num">{state === 'done' ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
              <span>{s}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Small read-only key/value list used on detail pages. */
export function Facts({ items }) {
  return (
    <dl className="facts">
      {items.filter((i) => i.value !== undefined && i.value !== null && i.value !== '').map((i) => (
        <div key={i.label} className="fact" title={i.title}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Score({ value, band }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="score num">
      <strong>{Math.round(value)}</strong>
      {band && <Pill tone={band}>{band === 'ok' ? 'Shortlist' : band === 'warn' ? 'Review' : 'Low'}</Pill>}
    </span>
  );
}

export function Section({ title, action, children, id }) {
  return (
    <section className="section" aria-labelledby={id}>
      <header className="section-head">
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function IconAdd() { return <Plus size={16} aria-hidden="true" />; }
export function MoveUp({ disabled, onClick, label }) {
  return <button type="button" className="icon-btn" disabled={disabled} onClick={onClick} aria-label={label}><ChevronUp size={16} aria-hidden="true" /></button>;
}
export function MoveDown({ disabled, onClick, label }) {
  return <button type="button" className="icon-btn" disabled={disabled} onClick={onClick} aria-label={label}><ChevronDown size={16} aria-hidden="true" /></button>;
}

/** Hook: remembers a value that a parent may change later, without an effect loop. */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { get, post } from '../../lib/api.js';
import { useRequisitions, useViews, useCommand } from '../../lib/data.js';
import { useAuthDownload } from '../reports/download.js';
import { STAGE_TEXT, statusTone, scoreTone, fmtAgo } from '../../lib/format.js';
import { Button, Pill, PageHeader, DataTable, Dialog, Field } from '../../components/ui.jsx';
import { Score } from '../../components/kit.jsx';
import { Select } from '../../components/Select.jsx';

const STAGES = [
  { value: '', label: 'Every stage' },
  { value: 'SCREENING', label: 'Screening' },
  { value: 'INTERVIEWS', label: 'Interviews' },
  { value: 'SELECTED', label: 'Selected' },
  { value: 'CLOSED', label: 'Closed' },
];

const EMPTY_FILTERS = { q: '', stage: '', requisitionId: '', onHold: '', view: '' };

/** Builds the query string from the filters that have a value. Every filter is sent together. */
function toQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value != null) params.set(key, String(value));
  }
  return params.toString();
}

export default function CandidatesPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState('');
  const [shared, setShared] = useState(false);
  const views = useViews();
  const roles = useRequisitions();
  const download = useAuthDownload();

  const list = useQuery({
    queryKey: ['candidates-list', filters],
    queryFn: () => get(`/api/candidates?${toQuery(filters)}`).then((d) => d.candidates),
    placeholderData: (prev) => prev,
  });
  const rows = list.data ?? [];

  const saveView = useCommand(
    () => post('/api/views', { name: viewName, filters, shared }),
    { refresh: [['views']], success: 'View saved.' },
  );

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const hasFilters = Object.values(filters).some((v) => v !== '');

  // A saved view restores every filter it was saved with. A ready-made view is just one more filter.
  const pickView = (value) => {
    if (value.startsWith('s:')) {
      const saved = (views.data?.saved ?? []).find((x) => String(x.id) === value.slice(2));
      if (saved) setFilters({ ...EMPTY_FILTERS, ...saved.filters });
      return;
    }
    setFilters((f) => ({ ...f, view: value.startsWith('p:') ? value.slice(2) : '' }));
  };

  const columns = [
    {
      key: 'name', header: 'Candidate',
      render: (c) => (
        <div>
          <Link to={`/candidates/${c.id}`} className="strong row-link" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
          <div className="muted small">{c.email || c.phone}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (c) => <span>{c.requisitionTitle}</span> },
    { key: 'ats', header: 'Screening score', render: (c) => <Score value={c.atsScore} band={scoreTone(c.atsScore)} /> },
    {
      key: 'status', header: 'Where they are',
      render: (c) => (
        <div className="stack-xs">
          <span className="small muted">{STAGE_TEXT[c.stage]}{c.activeRound ? ` · ${c.activeRound.name}` : ''}</span>
          <div className="pill-row">
            <Pill tone={statusTone(c.status)}>{c.status}</Pill>
            {c.onHold && <Pill tone="warn">On hold</Pill>}
          </div>
        </div>
      ),
    },
    { key: 'next', header: 'Next step', render: (c) => <span className={c.nextAction ? 'strong small' : 'muted small'}>{c.nextAction ?? 'Nothing needed'}</span> },
    { key: 'owner', header: 'Owner', render: (c) => <span className="muted small">{c.ownerName ?? '—'}</span> },
    { key: 'updated', header: 'Last change', render: (c) => <span className="muted small">{fmtAgo(c.updatedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Candidates"
        lead="Everyone in the process, in one list. Sort by what needs you. Click a name to open the full record."
        actions={
          <>
            <Button onClick={() => download(`/api/candidates/export.xlsx?${toQuery({ stage: filters.stage, requisitionId: filters.requisitionId, onHold: filters.onHold })}`, 'hiretrack-candidates.xlsx')}>Export to Excel</Button>
            <Button onClick={() => setSaving(true)}>Save this view</Button>
            <Button variant="primary" onClick={() => navigate('/candidates/new')}><Plus size={16} aria-hidden="true" /> Add candidate</Button>
          </>
        }
      />

      <div className="filters" role="search">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search by name, email, phone, PAN or role</span>
          <input type="search" placeholder="Name, email, phone, PAN or role" value={filters.q} onChange={set('q')} />
        </label>
        <Select aria-label="Ready-made or saved view" value={filters.view ? `p:${filters.view}` : ''} onChange={(e) => pickView(e.target.value)}>
          <option value="">All candidates</option>
          <optgroup label="Ready-made">
            {(views.data?.presets ?? []).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.label}</option>)}
          </optgroup>
          {(views.data?.saved ?? []).length > 0 && (
            <optgroup label="Saved">
              {views.data.saved.map((v) => <option key={v.id} value={`s:${v.id}`}>{v.name}{v.shared ? ' (shared)' : ''}</option>)}
            </optgroup>
          )}
        </Select>
        <Select aria-label="Stage" value={filters.stage} onChange={set('stage')}>
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Select aria-label="Role" value={filters.requisitionId} onChange={set('requisitionId')}>
          <option value="">Every role</option>
          {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.level ? ` · ${r.level}` : ''}</option>)}
        </Select>
        <Select aria-label="Hold status" value={filters.onHold} onChange={set('onHold')}>
          <option value="">On hold or not</option>
          <option value="true">On hold</option>
          <option value="false">Active</option>
        </Select>
        {hasFilters && (
          <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}><X size={16} aria-hidden="true" /> Clear filters</Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={list.isPending}
        error={list.error?.message}
        onRetry={() => list.refetch()}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/candidates/${c.id}`)}
        empty={{
          title: hasFilters ? 'No one matches these filters' : 'No candidates yet',
          body: hasFilters ? 'Try a different view, or clear the filters.' : 'Add a candidate from a resume or by hand.',
        }}
      />
      {rows.length > 0 && <p className="muted small mt">{rows.length} shown</p>}

      <Dialog
        open={saving}
        title="Save this view"
        onClose={() => setSaving(false)}
        footer={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={viewName.trim().length < 2 || saveView.isPending}
              onClick={() => saveView.mutate(undefined, {
                onSuccess: () => { setSaving(false); setViewName(''); setShared(false); },
              })}
            >
              Save view
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="muted small">The view keeps every filter you have set now.</p>
          <Field label="Name">
            {(p) => <input {...p} value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="For example: Java shortlist, Pune" />}
          </Field>
          <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the team</label>
        </div>
      </Dialog>
    </>
  );
}

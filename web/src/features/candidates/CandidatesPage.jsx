import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useCandidatesQuery, useRequisitions, useViews, useCommand, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { useAuthDownload } from '../reports/download.js';
import { post } from '../../lib/api.js';
import { useState as useLocalState } from 'react';
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

export default function CandidatesPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', stage: '', requisitionId: '', onHold: '', view: '' });
  const views = useViews();
  const download = useAuthDownload();
  const [saving, setSaving] = useLocalState(false);
  const [viewName, setViewName] = useLocalState('');
  const [shared, setShared] = useLocalState(false);
  const saveView = useCommand(() => post('/api/views', { name: viewName, filters: { stage: filters.stage, requisitionId: filters.requisitionId, onHold: filters.onHold, q: filters.q }, shared }), { refresh: [['views']], success: 'View saved.' });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const list = useCandidatesQuery(filters);
  const roles = useRequisitions();
  const rows = list.data?.candidates ?? [];

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
            <Button onClick={() => download(`/api/candidates/export.xlsx?${new URLSearchParams(Object.entries({ stage: filters.stage, requisitionId: filters.requisitionId }).filter(([, v]) => v)).toString()}`, 'hiretrack-candidates.xlsx')}>Export to Excel</Button>
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
        <Select aria-label="Ready-made or saved view" value={filters.view ? `p:${filters.view}` : ''} onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('s:')) {
            const saved = (views.data?.saved ?? []).find((x) => String(x.id) === v.slice(2));
            setFilters({ q: saved?.filters.q ?? '', stage: saved?.filters.stage ?? '', requisitionId: saved?.filters.requisitionId ?? '', onHold: saved?.filters.onHold ?? '', view: '' });
          } else setFilters((f) => ({ ...f, view: v.startsWith('p:') ? v.slice(2) : '' }));
        }}>
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
        <Select aria-label="Stage" value={filters.stage} onChange={set('stage')} disabled={!!filters.view}>
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
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        loading={list.isPending}
        error={list.error?.message}
        onRetry={() => list.refetch()}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/candidates/${c.id}`)}
        empty={{ title: filters.q || filters.stage || filters.requisitionId ? 'No one matches these filters' : 'No candidates yet', body: 'Add a candidate from a resume or by hand.' }}
      />
      {rows.length > 0 && <p className="muted small mt">{rows.length} shown</p>}
      {saving && (
        <Dialog open title="Save this view" onClose={() => setSaving(false)}
          footer={<><Button onClick={() => setSaving(false)}>Cancel</Button><Button variant="primary" disabled={viewName.trim().length < 2}
            onClick={() => saveView.mutate(undefined, { onSuccess: () => { setSaving(false); setViewName(''); setShared(false); } })}>Save view</Button></>}>
          <div className="stack">
            <Field label="Name"><input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="For example: Java shortlist, Pune" /></Field>
            <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the team</label>
          </div>
        </Dialog>
      )}
    </>
  );
}

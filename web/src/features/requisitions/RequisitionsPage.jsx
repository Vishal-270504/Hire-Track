import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useRequisitions } from '../../lib/data.js';
import { REQ_STATUS_TEXT, REQ_STATUS_TONE, fmtAgo, lpa } from '../../lib/format.js';
import { Button, EmptyState, PageHeader, Pill, DataTable } from '../../components/ui.jsx';
import { TabBar } from '../../components/kit.jsx';

const FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { value: 'OPEN', label: 'Open' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'REJECTED', label: 'Not approved' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function RequisitionsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const list = useRequisitions(filter || undefined);

  const columns = [
    {
      key: 'title',
      header: 'Role',
      render: (r) => (
        <Link to={`/requisitions/${r.id}`} className="strong row-link">
          {r.title}{r.level && <span className="muted"> · {r.level}</span>}
        </Link>
      ),
    },
    { key: 'where', header: 'Team and place', render: (r) => <span className="muted">{[r.team, r.remote ? 'Remote' : r.location].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'headcount', header: 'People', align: 'right', render: (r) => <span className="num">{r.headcount}</span> },
    { key: 'budget', header: 'Budget', align: 'right', render: (r) => <span className="num">{lpa(r.budgetMaxLpa)}</span> },
    {
      key: 'status', header: 'Status',
      render: (r) => <Pill tone={REQ_STATUS_TONE[r.status]}>{REQ_STATUS_TEXT[r.status]}</Pill>,
    },
    {
      key: 'approvals', header: 'Approvals',
      render: (r) => (r.totalSteps ? <span className="num">{r.approvedSteps} of {r.totalSteps}</span> : <span className="muted">—</span>),
    },
    { key: 'updated', header: 'Updated', render: (r) => <span className="muted">{fmtAgo(r.updatedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Roles"
        lead="Every job you are hiring for, from request to close. A role opens for applications only after every approver says yes."
        actions={<Button variant="primary" onClick={() => navigate('/requisitions/new')}><Plus size={16} aria-hidden="true" /> New role</Button>}
      />
      <TabBar
        value={filter}
        onValueChange={setFilter}
        items={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
      />
      <div className="tab-spacer" />
      <DataTable
        columns={columns}
        rows={list.data}
        loading={list.isPending}
        error={list.error?.message}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/requisitions/${r.id}`)}
        empty={{ title: 'No roles here yet', body: 'Start a new role. It takes about five minutes.' }}
      />
      {!list.isPending && !list.error && !list.data?.length && (
        <EmptyState title="Nothing in this list" action={<Button variant="primary" onClick={() => navigate('/requisitions/new')}>New role</Button>} />
      )}
    </>
  );
}

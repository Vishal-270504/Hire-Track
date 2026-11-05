import { Link } from 'react-router-dom';
import { useEmployees } from '../../lib/data.js';
import { fmtDate } from '../../lib/format.js';
import { DataTable, PageHeader, Pill, Button } from '../../components/ui.jsx';

const TONE = { 'On track': 'ok', Extended: 'warn', 'Needs improvement (PIP)': 'bad', Onboarding: 'accent' };
const PERIOD = { '30': '30-day', '60': '60-day', '90': '90-day', FINAL: 'Final' };

/** Everyone on probation: days left, the next review (and whether it is late), latest score and trend. */
export default function ProbationPage() {
  const list = useEmployees();
  const columns = [
    {
      key: 'name', header: 'Employee',
      render: (e) => <div><Link to={`/candidates/${e.id}`} className="strong row-link">{e.name}</Link><div className="muted small num">{e.employeeCode}</div></div>,
    },
    { key: 'joined', header: 'Joined', render: (e) => <span className="muted">{fmtDate(e.joinedOn)}</span> },
    {
      key: 'left', header: 'Days left', align: 'right',
      render: (e) => <span className="num">{e.daysLeft ?? '—'}</span>,
    },
    {
      key: 'next', header: 'Next review',
      render: (e) => e.nextReview
        ? <span className={e.nextReview.late ? 'bad-text' : e.nextReview.warn ? 'warn-text' : ''}>{PERIOD[e.nextReview.period]} · {fmtDate(e.nextReview.due)}{e.nextReview.late ? ' (late)' : ''}</span>
        : <span className="muted">None due</span>,
    },
    { key: 'latest', header: 'Latest score', align: 'right', render: (e) => <span className="num">{e.latest == null ? '—' : e.latest.toFixed(2)}</span> },
    {
      key: 'trend', header: 'Trend',
      render: (e) => <span className="muted small num">{e.trend.length ? e.trend.map((t) => t.weighted.toFixed(2)).join(' → ') : '—'}</span>,
    },
    { key: 'status', header: 'Status', render: (e) => <Pill tone={TONE[e.status] ?? 'neutral'}>{e.status}</Pill> },
  ];
  return (
    <>
      <PageHeader
        title="Probation"
        lead="Everyone still on probation. Late reviews are red, reviews due within a week are amber. Open a name for the full record."
        actions={<Button variant="ghost" onClick={() => list.refetch()}>Refresh</Button>}
      />
      <DataTable
        columns={columns}
        rows={list.data}
        loading={list.isPending}
        error={list.error?.message}
        onRetry={() => list.refetch()}
        rowKey={(e) => e.id}
        empty={{ title: 'Nobody is on probation right now', body: 'When a new joiner gets access, they appear here.' }}
      />
    </>
  );
}

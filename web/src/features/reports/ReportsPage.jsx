import { useAuthDownload } from './download.js';
import { useReports } from '../../lib/data.js';
import { useMe as useAuthMe, hasPermission } from '../../lib/auth.js';
import { PageHeader, Button, Skeleton } from '../../components/ui.jsx';
import { Section, Facts } from '../../components/kit.jsx';
import { fmtDate } from '../../lib/format.js';

const LABEL = {
  averageDaysToHire: 'Average days to hire',
  offerAcceptanceRate: 'Offer acceptance',
  probationPassRate: 'Probation pass rate',
  attrition90Days: 'Left within 90 days',
  averageDaysToFinalReview: 'Days to final review',
};

/** Hiring funnel, the key numbers from the PDF's dashboard, dropouts, and exports. */
export default function ReportsPage() {
  const r = useReports();
  const me = useAuthMe();
  const download = useAuthDownload();
  if (r.isPending) return <Skeleton rows={6} />;
  if (r.error) return <div role="alert" className="banner bad">{r.error.message}</div>;
  const d = r.data;
  const max = Math.max(1, ...d.funnel.map((f) => f.count));
  const pct = (v) => (v == null ? '—' : `${v}%`);
  return (
    <>
      <PageHeader title="Reports" lead={`Figures as of ${fmtDate(d.asOf)}. Each number explains itself on hover.`}
        actions={
          <>
            <Button onClick={() => download('/api/candidates/export.xlsx', 'hiretrack-candidates.xlsx')}>Export candidates (Excel)</Button>
            {hasPermission(me.data, 'audit.read') && <Button onClick={() => download('/api/audit/export.csv', 'hiretrack-audit.csv')}>Export audit log</Button>}
          </>
        } />

      <Section id="key" title="Key numbers">
        <Facts items={[
          { label: 'Open roles', value: d.openRoles },
          { label: 'Openings', value: d.openings },
          { label: 'Offers pending', value: d.offersPending },
          { label: 'Interviews today', value: d.interviewsToday },
          { label: 'Joined this month', value: d.joinedThisMonth },
          { label: LABEL.averageDaysToHire, value: d.averageDaysToHire == null ? '—' : `${d.averageDaysToHire} days`, title: d.definitions.averageDaysToHire },
          { label: LABEL.offerAcceptanceRate, value: pct(d.offerAcceptanceRate), title: d.definitions.offerAcceptanceRate },
          { label: LABEL.probationPassRate, value: pct(d.probationPassRate), title: d.definitions.probationPassRate },
          { label: LABEL.attrition90Days, value: pct(d.attrition90Days), title: d.definitions.attrition90Days },
          { label: LABEL.averageDaysToFinalReview, value: d.averageDaysToFinalReview == null ? '—' : `${d.averageDaysToFinalReview} days`, title: d.definitions.averageDaysToFinalReview },
        ]} />
      </Section>

      <Section id="funnel" title="Where candidates are">
        <ul className="funnel">
          {d.funnel.map((f) => (
            <li key={f.key} className="funnel-row">
              <span className="funnel-label">{f.label}</span>
              <span className="funnel-bar" aria-hidden="true"><span style={{ width: `${(f.count / max) * 100}%` }} /></span>
              <span className="num funnel-count">{f.count}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="dropouts" title="Why people did not join or stayed">
        {d.dropouts.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table className="table">
            <thead><tr><th>Reason</th><th className="num">People</th></tr></thead>
            <tbody>{d.dropouts.map((x) => <tr key={x.reason}><td>{x.reason}</td><td className="num">{x.n}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </>
  );
}


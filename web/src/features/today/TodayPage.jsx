import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { post } from '../../lib/api.js';
import { useDigest, useCommand, useReports } from '../../lib/data.js';
import { hasPermission } from '../../lib/auth.js';
import { useMe } from '../../lib/auth.js';
import { fmtDateTime, browserZone } from '../../lib/format.js';
import { Button, EmptyState, PageHeader, Pill, Skeleton } from '../../components/ui.jsx';
import { Section } from '../../components/kit.jsx';

const KIND = {
  interview_24h: ['Interview', 'accent'],
  interview_1h: ['Starts soon', 'warn'],
  feedback_due: ['Feedback', 'warn'],
  feedback_escalated: ['Feedback late', 'bad'],
  decision_needed: ['Decision', 'bad'],
  candidate_update_due: ['Update', 'info'],
  talent_pool_followup: ['Follow up', 'info'],
  mention: ['Mention', 'accent'],
};

/** The worklist: what needs the person now, most urgent first. Each item links to the record. */
export default function TodayPage() {
  const me = useMe();
  const digest = useDigest();
  const reports = useReports();
  const showNumbers = hasPermission(me.data, 'reports.read');
  const qc = useQueryClient();
  const first = me.data?.name?.split(' ')[0] ?? '';

  const done = useCommand((id) => post(`/api/reminders/${id}/done`, {}), {
    refresh: [['digest']],
    handled: false,
  });

  if (digest.isPending) return <Skeleton rows={4} />;
  if (digest.error) {
    return <div role="alert" className="banner bad">{digest.error.message} <Button onClick={() => digest.refetch()}>Try again</Button></div>;
  }
  const { overdue, today, later } = digest.data.groups;
  const total = digest.data.count;

  return (
    <>
      <PageHeader
        title={`Good to see you${first ? `, ${first}` : ''}`}
        lead={total ? `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} you. Start with the top of the list.` : 'Nothing needs you right now.'}
      />

      {showNumbers && reports.data && (
        <dl className="stats" aria-label="Key numbers">
          <div><dt>Open roles</dt><dd className="num">{reports.data.openRoles}</dd></div>
          <div><dt>Offers pending</dt><dd className="num">{reports.data.offersPending}</dd></div>
          <div><dt>Interviews today</dt><dd className="num">{reports.data.interviewsToday}</dd></div>
          <div><dt>Joined this month</dt><dd className="num">{reports.data.joinedThisMonth}</dd></div>
          <div><dt>Days to hire</dt><dd className="num">{reports.data.averageDaysToHire ?? '—'}</dd></div>
          <div><dt>Offer acceptance</dt><dd className="num">{reports.data.offerAcceptanceRate == null ? '—' : `${reports.data.offerAcceptanceRate}%`}</dd></div>
        </dl>
      )}

      {total === 0 ? (
        <EmptyState title="All caught up">
          Interviews, feedback that is due and candidates waiting on an update will show up here.
        </EmptyState>
      ) : (
        <div className="stack-lg">
          <Group title="Overdue" items={overdue} tone="bad" onDone={(id) => done.mutate(id, { onSuccess: () => toast.success('Marked done.') })} />
          <Group title="Today" items={today} onDone={(id) => done.mutate(id, { onSuccess: () => toast.success('Marked done.') })} />
          <Group title="Coming up" items={later} onDone={(id) => done.mutate(id, { onSuccess: () => toast.success('Marked done.') })} />
        </div>
      )}
      {qc && null}
    </>
  );
}

function Group({ title, items, tone, onDone }) {
  if (!items.length) return null;
  return (
    <Section id={`g-${title}`} title={`${title} · ${items.length}`}>
      <ul className="worklist">
        {items.map((r) => <Item key={r.id} r={r} tone={tone} onDone={onDone} />)}
      </ul>
    </Section>
  );
}

function Item({ r, tone, onDone }) {
  const [label, kindTone] = KIND[r.kind] ?? ['Reminder', 'neutral'];
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.body); toast.success('Copied the message.'); }
    catch { toast.error('Could not copy. Select the text and copy it.'); }
  };
  return (
    <li className="work-item">
      <div className="work-main">
        <div className="work-top">
          <Pill tone={tone ?? kindTone}>{label}</Pill>
          <span className="muted small">{fmtDateTime(r.due_at, browserZone())}</span>
        </div>
        <strong className="work-title">{r.title}</strong>
        {r.body && <p className="work-body">{r.body}</p>}
        <div className="work-links">
          {r.candidate_id && <Link to={`/candidates/${r.candidate_id}`}>Open {r.candidate_name ?? 'candidate'}</Link>}
        </div>
      </div>
      <div className="work-actions">
        {r.body && <Button variant="ghost" onClick={copy}><Copy size={16} aria-hidden="true" /> Copy text</Button>}
        <Button variant="secondary" onClick={() => onDone(r.id)}><Check size={16} aria-hidden="true" /> Done</Button>
      </div>
    </li>
  );
}

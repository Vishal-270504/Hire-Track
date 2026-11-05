import { Link } from 'react-router-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { MoveRight } from 'lucide-react';
import { post } from '../../lib/api.js';
import { useBoard, useCommand, REFRESH_ALL_CANDIDATE } from '../../lib/data.js';
import { statusTone, fmtAgo } from '../../lib/format.js';
import { Pill, PageHeader, Skeleton, Button } from '../../components/ui.jsx';

/** Kanban of every candidate by where they are. Each card has a "Move to" menu; moves that cannot be done here say why. */
export default function BoardPage() {
  const board = useBoard();
  if (board.isPending) return <Skeleton rows={5} />;
  if (board.error) return <div role="alert" className="banner bad">{board.error.message} <Button onClick={() => board.refetch()}>Try again</Button></div>;
  const total = board.data.reduce((n, col) => n + col.cards.length, 0);
  return (
    <>
      <PageHeader
        title="Board"
        lead={`${total} candidate${total === 1 ? '' : 's'} across the process. Open a card for the full record, or use Move to for the steps that can be taken from here.`}
      />
      <div className="board" role="region" aria-label="Candidates by stage" tabIndex={0}>
        {board.data.map((col) => (
          <section key={col.key} className="board-col" aria-labelledby={`col-${col.key}`}>
            <header className="board-head">
              <h2 id={`col-${col.key}`}>{col.label}</h2>
              <span className="num muted">{col.cards.length}</span>
            </header>
            <ul className="board-cards">
              {col.cards.map((card) => <Card key={card.id} card={card} />)}
              {col.cards.length === 0 && <li className="board-empty muted small">Nobody here</li>}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function Card({ card }) {
  const move = useCommand(
    (to) => post(`/api/candidates/${card.id}/board-move`, { to }),
    { refresh: REFRESH_ALL_CANDIDATE, success: 'Moved.' },
  );
  return (
    <li className="board-card">
      <Link to={`/candidates/${card.id}`} className="board-name">{card.name}</Link>
      <div className="muted small">{card.requisitionTitle}</div>
      <div className="board-meta">
        {card.atsScore != null && <span className="num small">{Math.round(card.atsScore)}</span>}
        <Pill tone={statusTone(card.status)}>{card.status}</Pill>
        {card.onHold && <Pill tone="warn">On hold</Pill>}
      </div>
      {card.nextAction && <div className="small board-next">{card.nextAction}</div>}
      <div className="board-foot">
        <span className="muted small">{fmtAgo(card.updatedAt)}</span>
        <Menu.Root>
          <Menu.Trigger className="btn btn-ghost board-move" aria-label={`Move ${card.name}`}>Move to <MoveRight size={14} aria-hidden="true" /></Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" align="end" sideOffset={6}>
              {card.moves.length === 0 && <div className="menu-label">No other steps</div>}
              {card.moves.map((m) => {
                const label = m.to.replace('_', ' ').toLowerCase();
                return (
                  <Menu.Item key={m.to} className="menu-item" disabled={!m.enabled}
                    title={m.enabled ? '' : m.reason}
                    onSelect={() => move.mutate(m.to, { onError: (e) => toast.error(e.message) })}>
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                    {!m.enabled && <span className="menu-why"> · {m.reason}</span>}
                  </Menu.Item>
                );
              })}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </li>
  );
}

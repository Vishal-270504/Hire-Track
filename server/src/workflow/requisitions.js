import { rule } from '../errors.js';

/**
 * Requisition lifecycle. Every status change goes through `moveTo`, so an illegal jump
 * (for example closing a draft, or opening one that nobody approved) is refused in one place.
 */
export const REQ_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  OPEN: 'OPEN',
  ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED',
};

export const LABEL = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  REJECTED: 'Not approved',
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
};

const TRANSITIONS = {
  DRAFT: ['PENDING_APPROVAL'],
  REJECTED: ['PENDING_APPROVAL', 'DRAFT'],
  PENDING_APPROVAL: ['OPEN', 'REJECTED'],
  OPEN: ['ON_HOLD', 'CLOSED'],
  ON_HOLD: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

/** Statuses where the core facts (title, budget, headcount, skills) may be edited. */
export const CORE_EDITABLE = ['DRAFT', 'REJECTED'];
/** Statuses where the hiring plan may be edited. */
export const PLAN_EDITABLE = ['DRAFT', 'REJECTED', 'OPEN', 'ON_HOLD'];

export function canMove(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function moveTo(from, to) {
  if (!canMove(from, to)) {
    throw rule(`You cannot change this requisition from "${LABEL[from]}" to "${LABEL[to]}".`, 'invalid_move');
  }
  return to;
}

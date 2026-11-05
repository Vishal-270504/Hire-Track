import { rule } from '../errors.js';

/**
 * Candidate lifecycle. Stage = where the person is; status = what is happening there.
 * Moves go through `moveStage`, so an illegal jump is refused in one place.
 */
export const STAGE = {
  SCREENING: 'SCREENING',
  INTERVIEWS: 'INTERVIEWS',
  SELECTED: 'SELECTED',
  CLOSED: 'CLOSED',
};

export const STAGE_LABEL = {
  SCREENING: 'Screening',
  INTERVIEWS: 'Interviews',
  SELECTED: 'Selected',
  CLOSED: 'Closed',
};

const TRANSITIONS = {
  SCREENING: ['INTERVIEWS', 'CLOSED'],
  INTERVIEWS: ['SELECTED', 'CLOSED'],
  SELECTED: ['CLOSED'], // becomes "offer" in the offer milestone
  CLOSED: ['SCREENING'], // only through "undo rejection"
};

export function moveStage(from, to) {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw rule(`A candidate in ${STAGE_LABEL[from]} cannot move straight to ${STAGE_LABEL[to]}.`, 'invalid_move');
  }
  return to;
}

export const UNDO_MINUTES = 10;

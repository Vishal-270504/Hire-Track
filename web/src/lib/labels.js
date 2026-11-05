/** Plain-language names for roles and statuses. The database keeps the codes; people see these words. */
export const ROLE_LABEL = {
  HR: 'HR',
  RECRUITER: 'Recruiter',
  INTERVIEWER: 'Interviewer',
  IT: 'IT',
  ADMIN: 'Admin',
};

export const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));

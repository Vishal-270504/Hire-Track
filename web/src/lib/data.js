import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get } from './api.js';

/*
 * Every server read is a query with a key; every write is a command that refreshes the
 * keys it affects. Pages never call fetch directly.
 */

export const useRequisitions = (status) => useQuery({
  queryKey: ['requisitions', status ?? 'all'],
  queryFn: () => get(`/api/requisitions${status ? `?status=${status}` : ''}`).then((d) => d.requisitions),
});
export const useRequisition = (id) => useQuery({ queryKey: ['requisition', id], queryFn: () => get(`/api/requisitions/${id}`), enabled: !!id });
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => get('/api/requisition-templates'), staleTime: Infinity });
export const useApprovers = () => useQuery({ queryKey: ['approvers'], queryFn: () => get('/api/requisitions/approver-options') });
export const usePeople = () => useQuery({ queryKey: ['people'], queryFn: () => get('/api/people'), staleTime: 300_000 });
export const useCandidatesQuery = (filters) => useQuery({
  queryKey: ['candidates', filters],
  queryFn: () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();
    // A ready-made view is computed by the server with its own endpoint.
    if (filters.view) return get(`/api/candidates/view?view=${encodeURIComponent(filters.view)}`);
    return get(`/api/candidates?${qs}`);
  },
});
export const useCandidate = (id) => useQuery({ queryKey: ['candidate', id], queryFn: () => get(`/api/candidates/${id}`).then((d) => d.candidate), enabled: !!id });
export const useHistory = (id) => useQuery({ queryKey: ['candidate-history', id], queryFn: () => get(`/api/candidates/${id}/history`), enabled: !!id });
export const useReqHistory = (id) => useQuery({ queryKey: ['requisition-history', id], queryFn: () => get(`/api/requisitions/${id}/history`), enabled: !!id });
export const useDigest = () => useQuery({ queryKey: ['digest'], queryFn: () => get('/api/digest'), refetchInterval: 60_000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get('/api/settings') });

/** A write. Refreshes the given query prefixes; shows a toast on failure unless the caller handles it. */
export function useCommand(fn, { refresh = [], success, handled = false } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      refresh.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
    },
    onError: (err) => {
      if (!handled) toast.error(err.message);
    },
  });
}

export const REFRESH_ALL_CANDIDATE = [['candidates'], ['candidate'], ['digest'], ['candidate-history'], ['offers'], ['joining'], ['employee'], ['employees'], ['board'], ['reports']];
export const REFRESH_REQUISITION = [['requisitions'], ['requisition'], ['requisition-history'], ['candidates']];

// ----- M6 to M9 reads -----
export const useOffers = (cid) => useQuery({ queryKey: ['offers', cid], queryFn: () => get(`/api/candidates/${cid}/offers`).then((d) => d.offers), enabled: !!cid });
export const useJoining = (cid) => useQuery({ queryKey: ['joining', cid], queryFn: () => get(`/api/candidates/${cid}/joining`), enabled: !!cid });
export const useEmployee = (eid) => useQuery({ queryKey: ['employee', eid], queryFn: () => get(`/api/employees/${eid}`).then((d) => d.employee), enabled: !!eid });
export const useEmployees = () => useQuery({ queryKey: ['employees'], queryFn: () => get('/api/employees').then((d) => d.employees) });
export const useBoard = () => useQuery({ queryKey: ['board'], queryFn: () => get('/api/board').then((d) => d.columns) });
export const useReports = () => useQuery({ queryKey: ['reports'], queryFn: () => get('/api/reports/summary') });
export const useViews = () => useQuery({ queryKey: ['views'], queryFn: () => get('/api/views') });
export const useSuggest = (roundId, enabled) => useQuery({ queryKey: ['suggest', roundId], queryFn: () => get(`/api/rounds/${roundId}/suggest-panel`), enabled: !!roundId && enabled });
export const useSettingsValues = () => useQuery({ queryKey: ['settings'], queryFn: () => get('/api/settings') });

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, ApiError } from './api.js';

export const ME_KEY = ['me'];

/** The signed-in person (with permissions) or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await get('/api/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

/** Whether the signed-in person may do an action. The server decides; this only reads its answer. */
export const hasPermission = (user, action) => !!user?.permissions?.includes(action);

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => post('/api/auth/login', body),
    onSuccess: (data) => qc.setQueryData(ME_KEY, data.user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/auth/logout'),
    onSettled: () => qc.setQueryData(ME_KEY, null),
  });
}

'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { UserStatus } from '../types';

export function useManagerAccounts(status: UserStatus | undefined, page: number) {
  return useQuery({
    queryKey: ['admin', 'managers', { status, page }],
    queryFn: ({ signal }) => unwrap(api('admin').GET('/api/v1/admin/managers', { params: { query: { status, page, limit: 20 } }, signal })),
    placeholderData: keepPreviousData,
  });
}

export function useManagerDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'suspend' }) =>
      action === 'approve'
        ? unwrap(api('admin').POST('/api/v1/admin/managers/{id}/approve', { params: { path: { id } } }))
        : unwrap(api('admin').POST('/api/v1/admin/managers/{id}/suspend', { params: { path: { id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'managers'] }),
  });
}

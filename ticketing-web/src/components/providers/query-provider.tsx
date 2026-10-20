'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { isApiError } from '@/lib/api/errors';
import type { Portal } from '@/lib/api/types';
import { getSession } from '@/lib/auth/session';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Never retry client errors (4xx) — they will not fix themselves.
        retry: (failures, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  useEffect(() => dropPrivateDataOnIdentityChange(client), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PORTALS: Portal[] = ['customer', 'manager', 'admin'];
/** Query keys whose data is public (shared by everyone); all others belong to a signed-in user. */
const PUBLIC_KEYS = new Set(['seat-map']);

/**
 * Query keys do not include the user, so when any portal signs out or switches account the cached
 * private data is removed — the next person on a shared device never sees the previous user's data.
 */
function dropPrivateDataOnIdentityChange(client: QueryClient): () => void {
  const unsubscribes = PORTALS.map((portal) => {
    const session = getSession(portal);
    let userId = session.getSnapshot().user?.id ?? null;
    return session.subscribe(() => {
      const { status, user } = session.getSnapshot();
      if (status === 'unknown') return;
      const next = user?.id ?? null;
      if (next === userId) return;
      if (userId !== null) client.removeQueries({ predicate: (query) => !PUBLIC_KEYS.has(String(query.queryKey[0])) });
      userId = next;
    });
  });
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

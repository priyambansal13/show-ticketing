'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Portal } from '@/lib/api/types';
import { getSession, type SessionSnapshot } from './session';

/** Current session of a portal; triggers the one-time restore (refresh) on first use. */
export function useSession(portal: Portal): SessionSnapshot & { session: ReturnType<typeof getSession> } {
  const session = getSession(portal);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  useEffect(() => {
    void session.restore().catch(() => undefined);
  }, [session]);
  return { ...snapshot, session };
}

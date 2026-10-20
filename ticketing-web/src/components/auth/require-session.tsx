'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/feedback';
import type { Portal, User } from '@/lib/api/types';
import { LOGIN_PATH, PORTAL_ROLE } from '@/lib/auth/portals';
import { useSession } from '@/lib/auth/use-session';

interface RequireSessionProps {
  portal: Portal;
  children: ReactNode;
  /** Where a signed-in but not-yet-approved manager goes (defaults to rendering children). */
  pendingPath?: string;
  /** Rendered instead of children when the check fails (default: nothing while redirecting). */
  fallback?: ReactNode;
  allowPending?: boolean;
}

/**
 * Client-side gate for a portal's pages. `proxy.ts` already redirects visitors without a session
 * hint; this component handles expired/revoked sessions and the wrong role or status.
 * It is UX only — the API enforces every permission.
 */
export function RequireSession(props: RequireSessionProps) {
  // usePathname() is request data under Cache Components, so the gate streams in behind its own boundary.
  return (
    <Suspense fallback={<Spinner label="Checking your session" />}>
      <Gate {...props} />
    </Suspense>
  );
}

function Gate({ portal, children, pendingPath, allowPending = false, fallback }: RequireSessionProps) {
  const { status, user } = useSession(portal);
  const router = useRouter();
  const pathname = usePathname();
  const verdict = judge(portal, status, user, allowPending);

  useEffect(() => {
    if (verdict === 'login') router.replace(`${LOGIN_PATH[portal]}?next=${encodeURIComponent(pathname)}`);
    if (verdict === 'pending' && pendingPath) router.replace(pendingPath);
  }, [verdict, portal, pathname, pendingPath, router]);

  if (verdict === 'ok') return <>{children}</>;
  if (verdict === 'wait') return <Spinner label="Checking your session" />;
  return <>{fallback ?? <Spinner label="Redirecting" />}</>;
}

function judge(portal: Portal, status: string, user: User | null, allowPending: boolean): 'ok' | 'wait' | 'login' | 'pending' {
  if (status === 'unknown') return 'wait';
  if (status === 'anonymous' || !user || user.role !== PORTAL_ROLE[portal] || user.status === 'SUSPENDED') return 'login';
  if (user.status === 'PENDING_VERIFICATION' && !allowPending) return 'pending';
  return 'ok';
}

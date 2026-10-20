'use client';

import { Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireSession } from '@/components/auth/require-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Notice } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/use-session';

export function PendingApproval() {
  return (
    <RequireSession portal="manager" allowPending>
      <PendingCard />
    </RequireSession>
  );
}

function PendingCard() {
  const { user, session } = useSession('manager');
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user?.status === 'ACTIVE') router.replace('/manager/dashboard');
  }, [user?.status, router]);

  const checkAgain = async () => {
    setChecking(true);
    setMessage(null);
    try {
      // A fresh access token carries the current account status.
      await session.refresh({ force: true });
      if (session.getSnapshot().user?.status !== 'ACTIVE')
        setMessage('Still awaiting approval. We will email you once an admin approves your account.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 sm:py-16">
      <Card>
        <CardHeader>
          <Clock aria-hidden className="text-warning size-8" />
          <h1 className="text-2xl font-semibold">Your account is awaiting approval</h1>
          <CardDescription>
            Thanks{user ? `, ${user.name.split(' ')[0]}` : ''}! An admin verifies every organizer before they can create venues, events and
            shows. This usually takes one business day.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div aria-live="polite">{message ? <Notice tone="warning">{message}</Notice> : null}</div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={checkAgain} loading={checking}>
              Check again
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await session.signOut('/manager/login');
              }}
            >
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

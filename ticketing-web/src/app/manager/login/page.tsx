import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { ManagerAuthShell } from '@/components/manager/auth-shell';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Organizer sign in', robots: { index: false } };

export default function ManagerLoginPage() {
  return (
    <ManagerAuthShell>
      <AuthCard title="Organizer sign in" description="Manage venues, events, shows and sales.">
        <Suspense fallback={<Spinner />}>
          <LoginForm portal="manager" registerHref="/manager/register" registerLabel="Hosting events for the first time?" />
        </Suspense>
      </AuthCard>
      <p className="text-muted-foreground pb-10 text-center text-sm">
        Looking for tickets?{' '}
        <Link href="/" className="text-foreground font-medium underline underline-offset-4">
          Go to ShowTime
        </Link>
      </p>
    </ManagerAuthShell>
  );
}

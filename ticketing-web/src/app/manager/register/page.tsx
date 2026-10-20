import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { ManagerAuthShell } from '@/components/manager/auth-shell';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Become an organizer', robots: { index: false } };

export default function ManagerRegisterPage() {
  return (
    <ManagerAuthShell>
      <AuthCard title="Become an organizer" description="An admin reviews every new organizer account before you can create events.">
        <Suspense fallback={<Spinner />}>
          <RegisterForm portal="manager" />
        </Suspense>
      </AuthCard>
    </ManagerAuthShell>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Create account', robots: { index: false } };

export default function CustomerRegisterPage() {
  return (
    <AuthCard title="Create your account" description="It takes less than a minute.">
      <Suspense fallback={<Spinner />}>
        <RegisterForm portal="customer" />
      </Suspense>
    </AuthCard>
  );
}

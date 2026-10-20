import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function CustomerLoginPage() {
  return (
    <AuthCard title="Sign in" description="Book tickets and see your bookings.">
      <Suspense fallback={<Spinner />}>
        <LoginForm portal="customer" registerHref="/register" />
      </Suspense>
    </AuthCard>
  );
}

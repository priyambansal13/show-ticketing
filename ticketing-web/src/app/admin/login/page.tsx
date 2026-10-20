import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { Brand } from '@/components/layout/brand';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Admin sign in', robots: { index: false } };

export default function AdminLoginPage() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center pt-10">
      <Brand suffix="Admin" />
      <AuthCard title="Admin sign in" description="Platform administrators only.">
        <Suspense fallback={<Spinner />}>
          <LoginForm portal="admin" />
        </Suspense>
      </AuthCard>
    </main>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import type { Portal } from '@/lib/api/types';
import { HOME_PATH, PORTAL_ROLE, safeNextPath } from '@/lib/auth/portals';
import { getSession } from '@/lib/auth/session';
import { loginSchema, type LoginValues } from '@/lib/validation/auth';

interface LoginFormProps {
  portal: Portal;
  registerHref?: string;
  registerLabel?: string;
}

export function LoginForm({ portal, registerHref, registerLabel }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await getSession(portal).login(values);
      if (user.role !== PORTAL_ROLE[portal]) throw new Error('This account cannot sign in here.');
      if (portal === 'manager' && user.status === 'PENDING_VERIFICATION') router.replace('/manager/pending');
      else router.replace(safeNextPath(params.get('next'), portal) || HOME_PATH[portal]);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <Field label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Sign in
      </Button>
      {registerHref ? (
        <p className="text-muted-foreground text-center text-sm">
          {registerLabel ?? 'New here?'}{' '}
          <Link href={registerHref} className="text-primary font-medium underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      ) : null}
    </form>
  );
}

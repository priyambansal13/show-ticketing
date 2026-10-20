'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm, type FieldValues, type Path } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, fieldErrors } from '@/lib/api/errors';
import { safeNextPath } from '@/lib/auth/portals';
import { getSession } from '@/lib/auth/session';
import { customerRegisterSchema, managerRegisterSchema } from '@/lib/validation/auth';

type FieldSpec = { name: string; label: string; type?: string; autoComplete?: string; optional?: boolean; hint?: string };

const COMMON: FieldSpec[] = [
  { name: 'name', label: 'Full name', autoComplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', optional: true },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: 'At least 10 characters.' },
];

const PORTALS = {
  customer: { schema: customerRegisterSchema, fields: COMMON, loginHref: '/login', submit: 'Create account' },
  manager: {
    schema: managerRegisterSchema,
    fields: [
      ...COMMON.slice(0, 2),
      { name: 'orgName', label: 'Organisation', autoComplete: 'organization' },
      { name: 'taxId', label: 'GSTIN / tax id', optional: true },
      ...COMMON.slice(2),
    ],
    loginHref: '/manager/login',
    submit: 'Apply for an organizer account',
  },
} as const;

export function RegisterForm({ portal }: { portal: keyof typeof PORTALS }) {
  const config = PORTALS[portal];
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FieldValues, unknown, z.output<typeof config.schema>>({
    resolver: zodResolver(config.schema as typeof customerRegisterSchema) as never,
    defaultValues: Object.fromEntries(config.fields.map((field) => [field.name, ''])),
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await getSession(portal).register(values);
      router.replace(portal === 'manager' ? '/manager/pending' : safeNextPath(params.get('next'), 'customer'));
    } catch (error) {
      const byField = fieldErrors(error);
      for (const [name, message] of Object.entries(byField)) form.setError(name as Path<FieldValues>, { message });
      setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      {config.fields.map((field: FieldSpec, index) => (
        <Field
          key={field.name}
          label={field.label}
          optional={field.optional}
          hint={field.hint}
          error={errors[field.name]?.message as string | undefined}
        >
          <Input type={field.type ?? 'text'} autoComplete={field.autoComplete} autoFocus={index === 0} {...form.register(field.name)} />
        </Field>
      ))}
      <Button type="submit" size="lg" loading={isSubmitting}>
        {config.submit}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{' '}
        <Link href={config.loginHref} className="text-primary font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

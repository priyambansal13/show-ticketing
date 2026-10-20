'use client';

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from './input';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  /** A single input/select/textarea; it receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
  optional?: boolean;
}

/** Label + control + hint/error wired together for screen readers (WCAG 1.3.1, 3.3.1). */
export function Field({ label, error, hint, className, children, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="text-muted-foreground ml-1 font-normal">(optional)</span> : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-danger text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message, children }: { message?: string | null; children?: ReactNode }) {
  if (!message) return null;
  return (
    <div role="alert" tabIndex={-1} className="border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm">
      {message}
      {children}
    </div>
  );
}

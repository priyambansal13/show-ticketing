import { AlertTriangle, Inbox } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Inbox aria-hidden className="text-muted-foreground size-8" />
      <p className="font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="border-danger/40 bg-danger/5 flex flex-col items-center gap-2 rounded-lg border px-6 py-10 text-center">
      <AlertTriangle aria-hidden className="text-danger size-8" />
      <p className="font-medium">{title}</p>
      {message ? <p className="text-muted-foreground max-w-md text-sm">{message}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-border bg-muted',
    success: 'border-success/40 bg-success/10',
    warning: 'border-warning/40 bg-warning/10',
  }[tone];
  return <div className={cn('rounded-md border px-4 py-3 text-sm', styles, className)}>{children}</div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}…
    </div>
  );
}

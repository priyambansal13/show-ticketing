import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-foreground',
      success: 'border-success/40 bg-success/10 text-success',
      warning: 'border-warning/40 bg-warning/10 text-warning',
      danger: 'border-danger/40 bg-danger/10 text-danger',
      primary: 'border-primary/40 bg-primary/10 text-primary',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: 'success',
  ACTIVE: 'success',
  ON_SALE: 'success',
  PUBLISHED: 'success',
  CAPTURED: 'success',
  PENDING: 'warning',
  PENDING_VERIFICATION: 'warning',
  SCHEDULED: 'warning',
  DRAFT: 'neutral',
  COMPLETED: 'neutral',
  EXPIRED: 'neutral',
  INACTIVE: 'neutral',
  REFUNDED: 'neutral',
  CANCELLED: 'danger',
  FAILED: 'danger',
  SUSPENDED: 'danger',
};

/** Status pill: the text carries the meaning, color only reinforces it. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} className={className}>
      {status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ')}
    </Badge>
  );
}

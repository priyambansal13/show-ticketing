'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/errors';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {back ? (
        <Link href={back.href} className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm">
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description ? <div className="text-muted-foreground mt-1 text-sm">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function LoadingRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function QueryError({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <ErrorState
      title={title}
      message={errorMessage(error)}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/** Responsive table wrapper: scrolls horizontally on small screens. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border">{children}</div>;
}

export const thClass = 'px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase';
export const tdClass = 'px-3 py-2.5 align-top';

export function DefinitionList({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium uppercase">{item.term}</dt>
          <dd className="mt-0.5 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/feedback';
import { FormError } from '@/components/ui/field';
import { errorMessage } from '@/lib/api/errors';
import { useManagerAccounts, useManagerDecision } from '@/lib/api/hooks/admin';
import type { ManagerAccount, UserStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/format';

const TABS: { label: string; status?: UserStatus }[] = [
  { label: 'Awaiting approval', status: 'PENDING_VERIFICATION' },
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Suspended', status: 'SUSPENDED' },
  { label: 'All' },
];

export function ManagerAccounts() {
  const [status, setStatus] = useState<UserStatus | undefined>('PENDING_VERIFICATION');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<ManagerAccount | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { data, isPending, isError, error, refetch } = useManagerAccounts(status, page);
  const decide = useManagerDecision();

  const approve = (account: ManagerAccount) =>
    decide.mutate({ id: account.id, action: 'approve' }, { onSuccess: () => setDone(`${account.name} can now create events.`) });

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Filter managers" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.label}
            size="sm"
            variant={tab.status === status ? 'primary' : 'outline'}
            aria-current={tab.status === status ? 'page' : undefined}
            onClick={() => {
              setStatus(tab.status);
              setPage(1);
            }}
          >
            {tab.label}
          </Button>
        ))}
      </nav>
      <div aria-live="polite">{done ? <Notice tone="success">{done}</Notice> : null}</div>
      <FormError message={decide.isError ? errorMessage(decide.error) : null} />

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} action={<Button onClick={() => void refetch()}>Try again</Button>} />
      ) : data.data.length === 0 ? (
        <EmptyState title="No manager accounts here" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Manager accounts</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Manager
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Organisation
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Registered
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((account) => (
                <tr key={account.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{account.name}</div>
                    <div className="text-muted-foreground">{account.email}</div>
                  </td>
                  <td className="px-4 py-3">{account.orgName ?? '—'}</td>
                  <td className="px-4 py-3">{formatDate(account.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={account.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {account.status !== 'ACTIVE' ? (
                        <Button
                          size="sm"
                          loading={decide.isPending && decide.variables?.id === account.id}
                          onClick={() => approve(account)}
                          aria-label={`Approve ${account.name}`}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {account.status !== 'SUSPENDED' ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirm(account)} aria-label={`Suspend ${account.name}`}>
                          Suspend
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.meta.total > data.meta.limit ? (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>Page {page}</span>
          <Button variant="outline" size="sm" disabled={page * data.meta.limit >= data.meta.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </nav>
      ) : null}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Suspend ${confirm?.name ?? 'manager'}?`}
        description="They are signed out everywhere immediately and cannot manage events until approved again."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={decide.isPending}
              onClick={() =>
                confirm &&
                decide.mutate(
                  { id: confirm.id, action: 'suspend' },
                  {
                    onSuccess: () => {
                      setDone(`${confirm.name} was suspended.`);
                      setConfirm(null);
                    },
                  },
                )
              }
            >
              Suspend
            </Button>
          </>
        }
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { ManagerAuthShell } from '@/components/manager/auth-shell';
import { PendingApproval } from '@/components/manager/pending-approval';

export const metadata: Metadata = { title: 'Awaiting approval', robots: { index: false } };

export default function ManagerPendingPage() {
  return (
    <ManagerAuthShell>
      <PendingApproval />
    </ManagerAuthShell>
  );
}

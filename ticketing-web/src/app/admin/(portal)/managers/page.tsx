import type { Metadata } from 'next';
import { ManagerAccounts } from '@/components/admin/manager-accounts';

export const metadata: Metadata = { title: 'Manager approvals', robots: { index: false } };

export default function ManagersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Manager accounts</h1>
        <p className="text-muted-foreground text-sm">Approve organizers before they can create venues, events and shows.</p>
      </div>
      <ManagerAccounts />
    </div>
  );
}

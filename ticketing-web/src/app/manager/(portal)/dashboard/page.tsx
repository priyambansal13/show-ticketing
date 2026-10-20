import type { Metadata } from 'next';
import { SalesDashboard } from '@/components/manager/sales-dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

export default function ManagerDashboardPage() {
  return <SalesDashboard />;
}

import type { Metadata } from 'next';
import { ManagerPortalShell } from '@/components/manager/portal-shell';

export const metadata: Metadata = { title: { default: 'Organizer', template: '%s · Organizer · ShowTime' }, robots: { index: false } };

export default function ManagerPortalLayout({ children }: { children: React.ReactNode }) {
  return <ManagerPortalShell>{children}</ManagerPortalShell>;
}

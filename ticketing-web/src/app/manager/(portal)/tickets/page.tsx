import type { Metadata } from 'next';
import { TicketCheckIn } from '@/components/manager/ticket-check-in';

export const metadata: Metadata = { title: 'Ticket check-in' };

export default function Page() {
  return <TicketCheckIn />;
}

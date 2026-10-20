import type { Metadata } from 'next';
import { EventDetail } from '@/components/manager/events';

export const metadata: Metadata = { title: 'Event' };

export default function Page() {
  return <EventDetail />;
}

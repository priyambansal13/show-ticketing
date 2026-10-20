import type { Metadata } from 'next';
import { EventList } from '@/components/manager/events';

export const metadata: Metadata = { title: 'Events' };

export default function Page() {
  return <EventList />;
}

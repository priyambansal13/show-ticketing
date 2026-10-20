import type { Metadata } from 'next';
import { NewEvent } from '@/components/manager/events';

export const metadata: Metadata = { title: 'New event' };

export default function Page() {
  return <NewEvent />;
}

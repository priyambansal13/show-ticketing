import type { Metadata } from 'next';
import { NewVenue } from '@/components/manager/venues';

export const metadata: Metadata = { title: 'New venue' };

export default function NewVenuePage() {
  return <NewVenue />;
}

import type { Metadata } from 'next';
import { VenueList } from '@/components/manager/venues';

export const metadata: Metadata = { title: 'Venues' };

export default function VenuesPage() {
  return <VenueList />;
}

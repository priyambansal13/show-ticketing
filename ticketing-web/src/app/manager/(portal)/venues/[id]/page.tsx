import type { Metadata } from 'next';
import { VenueDetail } from '@/components/manager/venues';

export const metadata: Metadata = { title: 'Venue' };

export default function VenueDetailPage() {
  return <VenueDetail />;
}

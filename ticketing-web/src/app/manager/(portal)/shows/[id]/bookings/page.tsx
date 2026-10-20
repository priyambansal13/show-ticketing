import type { Metadata } from 'next';
import { ShowBookings } from '@/components/manager/show-bookings';

export const metadata: Metadata = { title: 'Show bookings' };

export default function Page() {
  return <ShowBookings />;
}

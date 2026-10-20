import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireSession } from '@/components/auth/require-session';
import { BookingList } from '@/components/bookings/booking-list';
import { Spinner } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'My bookings', robots: { index: false } };

export default function BookingsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">My bookings</h1>
      <RequireSession portal="customer">
        <Suspense fallback={<Spinner />}>
          <BookingList />
        </Suspense>
      </RequireSession>
    </div>
  );
}

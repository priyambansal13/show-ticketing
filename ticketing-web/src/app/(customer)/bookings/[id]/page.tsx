import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RequireSession } from '@/components/auth/require-session';
import { BookingRoute } from '@/components/bookings/booking-detail';

export const metadata: Metadata = { title: 'Booking details', robots: { index: false } };

export default function BookingPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <Link href="/bookings" className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="size-4" /> My bookings
      </Link>
      <h1 className="text-2xl font-bold">Booking details</h1>
      <RequireSession portal="customer">
        <BookingRoute />
      </RequireSession>
    </div>
  );
}

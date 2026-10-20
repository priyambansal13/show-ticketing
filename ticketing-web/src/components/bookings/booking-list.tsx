'use client';

import { CalendarClock, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Poster } from '@/components/catalog/poster';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/errors';
import { useBookings } from '@/lib/api/hooks/customer';
import type { BookingStatus } from '@/lib/api/types';
import { cityLabel, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const FILTERS: { label: string; status?: BookingStatus }[] = [
  { label: 'All' },
  { label: 'Confirmed', status: 'CONFIRMED' },
  { label: 'Awaiting payment', status: 'PENDING' },
  { label: 'Cancelled', status: 'CANCELLED' },
];
const STATUSES = new Set<string>(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED']);

export function BookingList() {
  const params = useSearchParams();
  const router = useRouter();
  const rawStatus = params.get('status');
  const status = rawStatus && STATUSES.has(rawStatus) ? (rawStatus as BookingStatus) : undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useBookings(status, page);

  const go = (next: { status?: BookingStatus; page?: number }) => {
    const search = new URLSearchParams();
    if (next.status) search.set('status', next.status);
    if (next.page && next.page > 1) search.set('page', String(next.page));
    router.push(`/bookings${search.size ? `?${search}` : ''}`);
  };

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Filter bookings" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={filter.status === status ? 'primary' : 'outline'}
            aria-current={filter.status === status ? 'page' : undefined}
            onClick={() => go({ status: filter.status })}
          >
            {filter.label}
          </Button>
        ))}
      </nav>

      {isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading bookings">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load your bookings"
          message={errorMessage(error)}
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      ) : data.data.length === 0 ? (
        <EmptyState
          title={status ? 'No bookings with this status' : 'No bookings yet'}
          description="When you book tickets they will show up here."
          action={
            <Button asChild>
              <Link href="/events">Browse events</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className={cn('flex flex-col gap-3', isPlaceholderData && 'opacity-60')}>
            {data.data.map((booking) => (
              <li key={booking.id}>
                <Link href={`/bookings/${booking.id}`} className="hover:bg-muted flex gap-4 rounded-lg border p-3">
                  <Poster
                    url={booking.show?.posterUrl ?? null}
                    title={booking.show?.eventTitle ?? 'Booking'}
                    className="w-16 shrink-0"
                    sizes="64px"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="truncate font-semibold">{booking.show?.eventTitle ?? booking.bookingRef}</h2>
                      <StatusBadge status={booking.status} />
                    </div>
                    {booking.show ? (
                      <>
                        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                          <CalendarClock aria-hidden className="size-4" /> {formatDateTime(booking.show.startsAt)}
                        </p>
                        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                          <MapPin aria-hidden className="size-4" /> {booking.show.venueName} · {cityLabel(booking.show.city)}
                        </p>
                      </>
                    ) : null}
                    <p className="text-sm">
                      {booking.seats.map((seat) => `${seat.row}${seat.number}`).join(', ')} ·{' '}
                      {formatMoney(booking.totalAmount, booking.currency)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {data.meta.total > data.meta.limit ? (
            <nav aria-label="Pagination" className="flex items-center justify-center gap-3 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ status, page: page - 1 })}>
                Previous
              </Button>
              <span>
                Page {page} of {Math.ceil(data.meta.total / data.meta.limit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * data.meta.limit >= data.meta.total}
                onClick={() => go({ status, page: page + 1 })}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

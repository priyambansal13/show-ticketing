'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { useManagerShow, useShowBookings } from '@/lib/api/hooks/manager';
import type { BookingStatus } from '@/lib/api/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import { LoadingRows, PageHeader, Pagination, QueryError, TableWrap, tdClass, thClass } from './page-parts';

const PAGE_SIZE = 20;
const STATUSES: BookingStatus[] = ['CONFIRMED', 'PENDING', 'CANCELLED', 'EXPIRED', 'FAILED'];

export function ShowBookings() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const show = useManagerShow(id);
  const bookings = useShowBookings(id, page, status || undefined, PAGE_SIZE);
  const showLabel = show.data ? formatDateTime(show.data.startsAt) : 'Show';

  return (
    <>
      <PageHeader
        title="Bookings"
        description={`${showLabel} · customer emails are masked for privacy.`}
        back={{ href: `/manager/shows/${id}`, label: 'Show' }}
      />
      <Field label="Status" className="mb-4 w-full sm:w-56">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as BookingStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      {bookings.isLoading ? (
        <LoadingRows label="Loading bookings" />
      ) : bookings.isError ? (
        <QueryError error={bookings.error} onRetry={() => void bookings.refetch()} title="Could not load bookings" />
      ) : !bookings.data || bookings.data.data.length === 0 ? (
        <EmptyState
          title={status ? 'No bookings with this status' : 'No bookings yet'}
          description="Bookings appear here as customers buy tickets."
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full min-w-[48rem] text-sm">
              <caption className="sr-only">Bookings for this show</caption>
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th scope="col" className={thClass}>
                    Booking
                  </th>
                  <th scope="col" className={thClass}>
                    Customer
                  </th>
                  <th scope="col" className={thClass}>
                    Seats
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Amount
                  </th>
                  <th scope="col" className={thClass}>
                    Status
                  </th>
                  <th scope="col" className={thClass}>
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {bookings.data.data.map((booking) => (
                  <tr key={booking.id}>
                    <td className={`${tdClass} font-mono text-xs`}>{booking.bookingRef}</td>
                    <td className={tdClass}>
                      {booking.customer.name}
                      <div className="text-muted-foreground text-xs">{booking.customer.email}</div>
                    </td>
                    <td className={tdClass}>{booking.seats.map((seat) => seat.seatId).join(', ')}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(booking.totalAmount, booking.currency)}</td>
                    <td className={tdClass}>
                      <StatusBadge status={booking.status} />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(booking.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={page} limit={PAGE_SIZE} total={bookings.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

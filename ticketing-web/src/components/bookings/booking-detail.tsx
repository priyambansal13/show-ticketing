'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { BookingSummary } from '@/components/checkout/checkout';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Notice, Skeleton, Spinner } from '@/components/ui/feedback';
import { FormError } from '@/components/ui/field';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { shouldRotateIdempotencyKey } from '@/lib/api/client';
import { newIdempotencyKey, useBooking, useCancelBooking, useTicket } from '@/lib/api/hooks/customer';
import type { Booking } from '@/lib/api/types';
import { CANCELLATION_CUTOFF_HOURS, CANCELLATION_FEE_PERCENT } from '@/lib/config';
import { formatDateTime, formatMoney } from '@/lib/format';
import { fromPaise, toPaise } from '@/lib/money';
import { UUID } from '@/lib/validation/ids';

/** Reads the route id (inside RequireSession's Suspense boundary) and validates it. */
export function BookingRoute() {
  const { id } = useParams<{ id: string }>();
  return UUID.test(id) ? <BookingDetail bookingId={id} /> : <ErrorState title="Booking not found" />;
}

export function BookingDetail({ bookingId }: { bookingId: string }) {
  const params = useSearchParams();
  const { data: booking, isPending, isError, error, refetch } = useBooking(bookingId);

  if (isPending) return <Spinner label="Loading booking" />;
  if (isError || !booking) {
    const missing = isApiError(error) && error.status === 404;
    return (
      <ErrorState
        title={missing ? 'Booking not found' : 'Could not load this booking'}
        message={missing ? undefined : errorMessage(error)}
        action={
          missing ? (
            <Button asChild>
              <Link href="/bookings">My bookings</Link>
            </Button>
          ) : (
            <Button onClick={() => void refetch()}>Try again</Button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {params.get('confirmed') === '1' && booking.status === 'CONFIRMED' ? (
        <Notice tone="success">
          <strong>You&apos;re all set!</strong> Your booking is confirmed and the tickets were emailed to you.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">Status</span>
        <StatusBadge status={booking.status} />
        {booking.paymentStatus === 'REFUNDED' ? <StatusBadge status="REFUNDED" /> : null}
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <BookingSummary booking={booking} />
        <div className="flex flex-col gap-4">
          {booking.status === 'CONFIRMED' ? <TicketCard booking={booking} /> : null}
          {booking.status === 'PENDING' ? (
            <Card>
              <CardHeader>
                <CardTitle>Awaiting payment</CardTitle>
                <CardDescription>
                  {booking.holdExpiresAt ? `Seats held until ${formatDateTime(booking.holdExpiresAt)}.` : null}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link href={`/checkout/${booking.id}`}>Complete payment</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {booking.status === 'CANCELLED' ? (
            <Notice>
              Cancelled{booking.cancelledAt ? ` on ${formatDateTime(booking.cancelledAt)}` : ''}. Any refund goes back to your original
              payment method within 5–7 working days.
            </Notice>
          ) : null}
          {booking.status === 'CONFIRMED' ? <CancelBooking booking={booking} /> : null}
        </div>
      </div>
    </div>
  );
}

function TicketCard({ booking }: { booking: Booking }) {
  const { data: ticket, isPending, isError, refetch } = useTicket(booking.id, true);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your ticket</CardTitle>
        <CardDescription>Show this QR code at the entrance. It admits everyone in this booking once.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        {isPending ? (
          <Skeleton className="size-56" />
        ) : isError || !ticket || !ticket.qrCodeDataUrl.startsWith('data:image/png;base64,') ? (
          <Button variant="outline" onClick={() => void refetch()}>
            Load ticket
          </Button>
        ) : (
          <>
            <Image
              src={ticket.qrCodeDataUrl}
              alt={`Ticket QR code for booking ${booking.bookingRef}`}
              width={224}
              height={224}
              className="rounded-md bg-white p-2"
              unoptimized
            />
            <p className="font-mono text-sm font-semibold">{booking.bookingRef}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CancelBooking({ booking }: { booking: Booking }) {
  const [open, setOpen] = useState(false);
  const cancel = useCancelBooking();
  const key = useRef(newIdempotencyKey());
  const startsAt = booking.show ? Date.parse(booking.show.startsAt) : null;
  // eslint-disable-next-line react-hooks/purity -- display-only estimate; the API decides with its own clock
  const closed = startsAt !== null && startsAt - Date.now() < CANCELLATION_CUTOFF_HOURS * 3_600_000;
  const total = toPaise(booking.totalAmount);
  const fee = Math.round((total * CANCELLATION_FEE_PERCENT) / 100);

  if (closed) {
    return <p className="text-muted-foreground text-xs">Cancellation closes {CANCELLATION_CUTOFF_HOURS} hours before the show.</p>;
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) cancel.reset();
        }}
        title="Cancel this booking?"
        description={`A ${CANCELLATION_FEE_PERCENT}% cancellation fee applies. This cannot be undone.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep booking
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(
                  { bookingId: booking.id, idempotencyKey: key.current },
                  {
                    onSuccess: () => setOpen(false),
                    onError: (error) => {
                      if (shouldRotateIdempotencyKey(error)) key.current = newIdempotencyKey();
                    },
                  },
                )
              }
            >
              Cancel booking
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-right">{formatMoney(booking.totalAmount, booking.currency)}</dd>
          <dt className="text-muted-foreground">Cancellation fee (est.)</dt>
          <dd className="text-right">− {formatMoney(fromPaise(fee), booking.currency)}</dd>
          <dt className="font-medium">Refund (est.)</dt>
          <dd className="text-right font-medium">{formatMoney(fromPaise(total - fee), booking.currency)}</dd>
        </dl>
        <div className="mt-3">
          <FormError message={cancel.isError ? errorMessage(cancel.error) : null} />
        </div>
      </Dialog>
    </>
  );
}

'use client';

import { CalendarClock, CircleCheck, Clock, MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Notice, Spinner } from '@/components/ui/feedback';
import { FormError } from '@/components/ui/field';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { shouldRotateIdempotencyKey } from '@/lib/api/client';
import { newIdempotencyKey, payments, useBooking, usePaymentSettled, useReleaseHold } from '@/lib/api/hooks/customer';
import type { Booking, PaymentOrder } from '@/lib/api/types';
import { countdownAnnouncement, formatClock, useSecondsLeft } from '@/lib/checkout/countdown';
import { type OutcomeView, viewForSettledBooking, viewForVerification } from '@/lib/checkout/outcome';
import { openRazorpay } from '@/lib/checkout/razorpay';
import { useSession } from '@/lib/auth/use-session';
import { cityLabel, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { UUID } from '@/lib/validation/ids';

type Confirmation = Parameters<typeof payments.verify>[0];
type Step =
  | { name: 'idle' }
  | { name: 'paying' }
  | { name: 'test-checkout'; order: PaymentOrder }
  /** The provider took the money but we could not confirm it with the API yet. */
  | { name: 'confirming'; confirmation: Confirmation; error: string | null }
  | { name: 'done'; view: OutcomeView };

const confirmationKey = (bookingId: string) => `bms:confirmation:${bookingId}`;
const VERIFY_BACKOFF_MS = [0, 1_000, 3_000];

function loadConfirmation(bookingId: string): Confirmation | null {
  try {
    const raw = sessionStorage.getItem(confirmationKey(bookingId));
    const value = raw ? (JSON.parse(raw) as Partial<Confirmation>) : null;
    return value && typeof value.orderId === 'string' && typeof value.paymentId === 'string' && typeof value.signature === 'string'
      ? { orderId: value.orderId, paymentId: value.paymentId, signature: value.signature }
      : null;
  } catch {
    return null;
  }
}

/** Reads the route id (inside RequireSession's Suspense boundary) and validates it. */
export function CheckoutRoute() {
  const { bookingId } = useParams<{ bookingId: string }>();
  return UUID.test(bookingId) ? <Checkout bookingId={bookingId} /> : <ErrorState title="Booking not found" />;
}

export function Checkout({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const { user } = useSession('customer');
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const waiting = (step.name === 'done' && step.view.kind === 'processing') || step.name === 'confirming';
  const { data: booking, isPending, isError, error, refetch } = useBooking(bookingId, { refetchInterval: waiting ? 5_000 : false });
  const release = useReleaseHold();
  const settled = usePaymentSettled();
  const [formError, setFormError] = useState<string | null>(null);
  // Reused while retries cannot have produced a stored outcome (network errors); rotated otherwise.
  const initiateKey = useRef(newIdempotencyKey());
  const secondsLeft = useSecondsLeft(booking?.status === 'PENDING' ? booking.holdExpiresAt : null);

  const done = useCallback(
    (view: OutcomeView) => {
      if (view.kind !== 'processing') sessionStorage.removeItem(confirmationKey(bookingId));
      if (view.kind === 'confirmed') router.replace(`/bookings/${bookingId}?confirmed=1`);
      else setStep({ name: 'done', view });
    },
    [bookingId, router],
  );

  const confirming = useRef(false);
  /** verify is safe to repeat (the API answers already_settled), so retry it before giving up. One loop at a time. */
  const confirm = useCallback(
    async (confirmation: Confirmation) => {
      if (confirming.current) return;
      confirming.current = true;
      try {
        sessionStorage.setItem(confirmationKey(bookingId), JSON.stringify(confirmation));
        let lastError: unknown = null;
        for (const delay of VERIFY_BACKOFF_MS) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          try {
            const result = await payments.verify(confirmation);
            settled(result.booking);
            done(viewForVerification(result));
            return;
          } catch (verifyError) {
            lastError = verifyError;
            if (isApiError(verifyError) && verifyError.status > 0 && verifyError.status < 500) break;
          }
        }
        setStep({ name: 'confirming', confirmation, error: errorMessage(lastError) });
      } finally {
        confirming.current = false;
      }
    },
    [bookingId, done, settled],
  );

  // Resume a confirmation that was interrupted (reload, network drop) instead of offering to pay again — once.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = loadConfirmation(bookingId);
    if (pending) void confirm(pending);
  }, [bookingId, confirm]);

  // While waiting on the bank / the API, a booking that reaches a final state ends the wait.
  useEffect(() => {
    if (!waiting || !booking) return;
    const view = viewForSettledBooking(booking, step.name === 'confirming');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to polled server state
    if (view) done(view);
  }, [waiting, booking, done, step.name]);

  // While confirming, keep retrying verify on a slow interval (safe to repeat) in case the webhook is lost.
  const pendingConfirmation = step.name === 'confirming' ? step.confirmation : null;
  useEffect(() => {
    if (!pendingConfirmation) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 10) clearInterval(timer);
      else void confirm(pendingConfirmation);
    }, 30_000);
    return () => clearInterval(timer);
  }, [pendingConfirmation, confirm]);

  // The countdown hit zero: the server has (or will have) expired the hold — refresh to show it.
  useEffect(() => {
    if (secondsLeft === 0) void refetch();
  }, [secondsLeft, refetch]);

  if (isPending) return <Spinner label="Loading your booking" />;
  if (isError || !booking) {
    return (
      <ErrorState
        title="Could not load this booking"
        message={errorMessage(error)}
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  const failed = (payError: unknown) => {
    if (shouldRotateIdempotencyKey(payError)) initiateKey.current = newIdempotencyKey();
    setFormError(errorMessage(payError));
    setStep({ name: 'idle' });
    void refetch();
  };

  const pay = async () => {
    setFormError(null);
    setStep({ name: 'paying' });
    let order: PaymentOrder;
    try {
      order = await payments.initiate(booking.id, initiateKey.current);
    } catch (payError) {
      failed(payError);
      return;
    }
    if (order.provider === 'fake') {
      setStep({ name: 'test-checkout', order });
      return;
    }
    let confirmation: Confirmation | null;
    try {
      confirmation = await openRazorpay(order, { name: user?.name, email: user?.email });
    } catch (payError) {
      failed(payError);
      return;
    }
    if (!confirmation) setStep({ name: 'idle' });
    else await confirm(confirmation);
  };

  const completeTestPayment = async (order: PaymentOrder) => {
    if (!order.orderId) return;
    setStep({ name: 'paying' });
    let confirmation: Confirmation;
    try {
      confirmation = await payments.fakeComplete(order.orderId);
    } catch (payError) {
      failed(payError);
      return;
    }
    await confirm(confirmation);
  };

  const changeSeats = async () => {
    try {
      await release.mutateAsync(booking.id);
    } catch {
      // The hold may already be gone (expired/released); either way the seats are free again.
    }
    router.push(`/shows/${booking.showId}/seats`);
  };

  if (step.name === 'done') return <OutcomePanel view={step.view} booking={booking} />;
  if (step.name === 'confirming') {
    return (
      <div role="status" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border p-8 text-center">
        <Spinner label="Confirming your payment" />
        <h2 className="text-xl font-semibold">Payment received — confirming your booking</h2>
        <p className="text-muted-foreground text-sm">
          Please do not pay again. We are confirming the payment with our server; this page updates automatically. If the seats are no
          longer available you are refunded in full.
        </p>
        {step.error ? <p className="text-muted-foreground text-xs">Last attempt: {step.error}</p> : null}
        <Button variant="outline" onClick={() => void confirm(step.confirmation)}>
          Retry confirmation
        </Button>
      </div>
    );
  }

  // A payment in flight wins over the countdown: never offer "pick seats again" while it may settle.
  if (step.name === 'paying') return <Spinner label="Processing your payment" />;
  const expired = booking.status === 'EXPIRED' || (booking.status === 'PENDING' && secondsLeft === 0);
  if (booking.status === 'CONFIRMED') {
    return (
      <Notice tone="success">
        This booking is already confirmed.{' '}
        <Link className="font-medium underline" href={`/bookings/${booking.id}`}>
          View your tickets
        </Link>
      </Notice>
    );
  }
  if (expired || booking.status !== 'PENDING') {
    return (
      <ErrorState
        title={expired ? 'Your seat hold expired' : 'This booking can no longer be paid'}
        message={
          expired
            ? 'Seats are held for a few minutes only. Pick your seats again to continue.'
            : `Booking status: ${booking.status.toLowerCase()}.`
        }
        action={
          <Button asChild>
            <Link href={`/shows/${booking.showId}/seats`}>Pick seats again</Link>
          </Button>
        }
      />
    );
  }

  const urgent = secondsLeft !== null && secondsLeft <= 60;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <BookingSummary booking={booking} />
      <Card className="h-fit md:sticky md:top-20">
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <div className={cn('flex items-center gap-2 text-sm', urgent ? 'text-danger font-semibold' : 'text-muted-foreground')}>
            <Clock aria-hidden className="size-4" />
            <span>
              Seats held for <span className="font-mono tabular-nums">{secondsLeft === null ? '–' : formatClock(secondsLeft)}</span>
            </span>
          </div>
          <p aria-live="polite" className="sr-only">
            {countdownAnnouncement(secondsLeft)}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="flex items-baseline justify-between border-t pt-4">
            <dt className="text-muted-foreground text-sm">Total</dt>
            <dd className="text-2xl font-bold">{formatMoney(booking.totalAmount, booking.currency)}</dd>
          </dl>
          <FormError message={formError} />
          <Button size="lg" onClick={() => void pay()}>
            Pay {formatMoney(booking.totalAmount, booking.currency)}
          </Button>
          <Button variant="ghost" loading={release.isPending} onClick={() => void changeSeats()}>
            Change seats
          </Button>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <ShieldCheck aria-hidden className="size-4" /> Payments are processed securely by our payment partner.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={step.name === 'test-checkout'}
        onOpenChange={(open) => !open && setStep({ name: 'idle' })}
        title="Test payment"
        description="This environment uses a simulated payment provider. No real money moves."
        footer={
          <>
            <Button variant="outline" onClick={() => setStep({ name: 'idle' })}>
              Cancel
            </Button>
            <Button onClick={() => step.name === 'test-checkout' && void completeTestPayment(step.order)}>Pay (test)</Button>
          </>
        }
      >
        {step.name === 'test-checkout' ? (
          <p className="text-sm">
            Order <span className="font-mono">{step.order.orderId}</span> for{' '}
            <strong>{formatMoney(step.order.amount, step.order.currency)}</strong>.
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

export function BookingSummary({ booking }: { booking: Booking }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{booking.show?.eventTitle ?? 'Your booking'}</CardTitle>
        {booking.show ? (
          <div className="text-muted-foreground flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1.5">
              <CalendarClock aria-hidden className="size-4" /> {formatDateTime(booking.show.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden className="size-4" /> {booking.show.venueName}, {booking.show.hallName} · {cityLabel(booking.show.city)}
            </span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <caption className="sr-only">Seats in this booking</caption>
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th scope="col" className="py-2 font-medium">
                Seat
              </th>
              <th scope="col" className="py-2 font-medium">
                Section
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {booking.seats.map((seat) => (
              <tr key={seat.seatId} className="border-b last:border-0">
                <td className="py-2 font-medium">
                  {seat.row}
                  {seat.number}
                </td>
                <td className="py-2">{seat.section}</td>
                <td className="py-2 text-right">{formatMoney(seat.price, booking.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground mt-3 text-xs">Booking reference {booking.bookingRef}</p>
      </CardContent>
    </Card>
  );
}

function OutcomePanel({ view, booking }: { view: OutcomeView; booking: Booking }) {
  return (
    <div role="status" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border p-8 text-center">
      {view.kind === 'processing' ? (
        <Spinner label="Waiting for your bank" />
      ) : (
        <CircleCheck aria-hidden className="text-muted-foreground size-10" />
      )}
      <h2 className="text-xl font-semibold">{view.title}</h2>
      <p className="text-muted-foreground text-sm">{view.message}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href={`/bookings/${booking.id}`}>View booking</Link>
        </Button>
        {view.kind === 'refunded' ? (
          <Button asChild>
            <Link href={`/shows/${booking.showId}/seats`}>Pick other seats</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

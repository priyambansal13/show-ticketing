import type { Booking, PaymentVerification } from '@/lib/api/types';

export type OutcomeView = { kind: 'confirmed' | 'refunded' | 'review' | 'processing'; title: string; message: string };

/** What each settlement outcome of POST /payments/verify means for the customer. */
export function describeOutcome(outcome: PaymentVerification['outcome']): OutcomeView {
  switch (outcome) {
    case 'confirmed':
    case 'already_settled':
      return { kind: 'confirmed', title: 'Booking confirmed', message: 'Your tickets are ready. We also emailed them to you.' };
    case 'duplicate_refunded':
      return {
        kind: 'confirmed',
        title: 'Booking confirmed',
        message: 'You were charged twice, so we refunded the extra payment automatically.',
      };
    case 'refunded_seats_unavailable':
      return {
        kind: 'refunded',
        title: 'Seats no longer available',
        message: 'Your hold expired before the payment arrived and the seats were taken. We have refunded you in full.',
      };
    case 'refunded_not_payable':
      return {
        kind: 'refunded',
        title: 'Booking could not be completed',
        message: 'This booking can no longer be paid (for example, the show was cancelled). We have refunded you in full.',
      };
    case 'amount_mismatch':
      return {
        kind: 'review',
        title: 'Payment under review',
        message: 'The amount paid did not match the booking. Our team will review it and contact you; you will not lose your money.',
      };
    case 'pending_capture':
      return {
        kind: 'processing',
        title: 'Payment processing',
        message: 'Your bank is still confirming the payment. This page updates automatically, and we will email you once it is done.',
      };
  }
}

/** The outcome to show, decided from the booking the API returned (not only the outcome code). */
export function viewForVerification(result: PaymentVerification): OutcomeView {
  const view = describeOutcome(result.outcome);
  if (view.kind === 'confirmed' && result.booking.status !== 'CONFIRMED') {
    return {
      kind: 'refunded',
      title: 'Payment refunded',
      message: 'This payment was refunded because the booking could not be completed.',
    };
  }
  return view;
}

/**
 * While a payment is still settling: is the booking in a final state? (null = keep waiting)
 * An EXPIRED booking is NOT final while the payment is CREATED/AUTHORIZED — a late webhook or verify
 * can still re-hold and confirm it (late-payment path). Only a FAILED payment, a refund, or a capture
 * on a dead booking (which the API refunds) ends the wait.
 */
export function viewForSettledBooking(
  booking: Pick<Booking, 'status' | 'paymentStatus'>,
  /** We hold a successful provider confirmation: an earlier failed attempt's FAILED row is not the final word. */
  holdingConfirmation = false,
): OutcomeView | null {
  if (booking.status === 'CONFIRMED') return describeOutcome('confirmed');
  if (booking.paymentStatus === 'REFUNDED') return describeOutcome('refunded_not_payable');
  if (booking.status === 'PENDING') return null;
  if (booking.paymentStatus === 'CAPTURED' || booking.paymentStatus === 'CAPTURED_DUPLICATE')
    return describeOutcome('refunded_seats_unavailable');
  if (booking.paymentStatus === 'FAILED' && !holdingConfirmation) {
    return {
      kind: 'refunded',
      title: 'Payment did not complete',
      message: 'The payment failed, so you were not charged. Pick your seats again to retry.',
    };
  }
  return null;
}

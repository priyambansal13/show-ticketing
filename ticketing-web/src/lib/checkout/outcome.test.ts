import { describe, expect, it } from 'vitest';
import { countdownAnnouncement, formatClock } from './countdown';
import { describeOutcome, viewForSettledBooking } from './outcome';

describe('checkout helpers', () => {
  it('maps every settlement outcome to customer copy', () => {
    expect(describeOutcome('confirmed').kind).toBe('confirmed');
    expect(describeOutcome('already_settled').kind).toBe('confirmed');
    expect(describeOutcome('duplicate_refunded').kind).toBe('confirmed');
    expect(describeOutcome('refunded_seats_unavailable').kind).toBe('refunded');
    expect(describeOutcome('refunded_not_payable').kind).toBe('refunded');
    expect(describeOutcome('amount_mismatch').kind).toBe('review');
    expect(describeOutcome('pending_capture').kind).toBe('processing');
  });

  it('announces the countdown only at thresholds', () => {
    expect(countdownAnnouncement(240)).toBe('');
    expect(countdownAnnouncement(60)).toMatch(/one minute/);
    expect(countdownAnnouncement(9)).toMatch(/10 seconds/);
    expect(countdownAnnouncement(0)).toMatch(/expired/);
    expect(countdownAnnouncement(null)).toBe('');
  });

  it('formats the clock', () => {
    expect(formatClock(299)).toBe('4:59');
    expect(formatClock(5)).toBe('0:05');
  });

  it('keeps waiting on an expired booking whose payment may still land', () => {
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: 'CREATED' })).toBeNull();
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: 'AUTHORIZED' })).toBeNull();
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: null })).toBeNull();
    expect(viewForSettledBooking({ status: 'PENDING', paymentStatus: 'CAPTURED' })).toBeNull();
  });

  it('ends the wait on final states', () => {
    expect(viewForSettledBooking({ status: 'CONFIRMED', paymentStatus: 'CAPTURED' })?.kind).toBe('confirmed');
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: 'REFUNDED' })?.kind).toBe('refunded');
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: 'CAPTURED' })?.kind).toBe('refunded');
    expect(viewForSettledBooking({ status: 'FAILED', paymentStatus: 'FAILED' })?.kind).toBe('refunded');
    // A successful confirmation in hand outranks an earlier attempt's FAILED row.
    expect(viewForSettledBooking({ status: 'EXPIRED', paymentStatus: 'FAILED' }, true)).toBeNull();
  });
});

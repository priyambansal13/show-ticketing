'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, newIdempotencyKey, unwrap } from '../client';
import type { Booking, BookingStatus, CheckoutConfirmation, PaymentOrder, PaymentVerification, SeatMap } from '../types';

export const customerKeys = {
  seatMap: (showId: string) => ['seat-map', showId] as const,
  bookings: (status: BookingStatus | undefined, page: number) => ['bookings', { status, page }] as const,
  booking: (id: string) => ['booking', id] as const,
  ticket: (id: string) => ['ticket', id] as const,
};

/** Live seat map (public). Socket updates are merged into this cache entry by useLiveSeats. */
export function useSeatMap(showId: string) {
  return useQuery({
    queryKey: customerKeys.seatMap(showId),
    queryFn: ({ signal }) => unwrap(api().GET('/api/v1/shows/{id}/seats', { params: { path: { id: showId } }, signal })),
    staleTime: 15_000,
  });
}

export function useBookings(status: BookingStatus | undefined, page: number) {
  return useQuery({
    queryKey: customerKeys.bookings(status, page),
    queryFn: ({ signal }) => unwrap(api('customer').GET('/api/v1/bookings', { params: { query: { status, page, limit: 10 } }, signal })),
    placeholderData: keepPreviousData,
  });
}

export function useBooking(id: string, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: customerKeys.booking(id),
    queryFn: ({ signal }) => unwrap(api('customer').GET('/api/v1/bookings/{id}', { params: { path: { id } }, signal })),
    refetchInterval: options?.refetchInterval,
  });
}

export function useTicket(id: string, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.ticket(id),
    queryFn: ({ signal }) => unwrap(api('customer').GET('/api/v1/bookings/{id}/ticket', { params: { path: { id } }, signal })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Holds seats. The caller passes the Idempotency-Key so a retried click reuses it. */
export function useHoldSeats() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ showId, seatIds, idempotencyKey }: { showId: string; seatIds: string[]; idempotencyKey: string }) =>
      unwrap(
        api('customer').POST('/api/v1/bookings/hold', {
          params: { header: { 'Idempotency-Key': idempotencyKey } },
          body: { showId, seatIds },
        }),
      ),
    onSuccess: (booking) => {
      queryClient.setQueryData(customerKeys.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useReleaseHold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      unwrap(api('customer').DELETE('/api/v1/bookings/{id}/hold', { params: { path: { id: bookingId } } })),
    onSettled: (_data, _error, bookingId) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.booking(bookingId) });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, idempotencyKey }: { bookingId: string; idempotencyKey: string }) =>
      unwrap(
        api('customer').POST('/api/v1/bookings/{id}/cancel', {
          params: { path: { id: bookingId }, header: { 'Idempotency-Key': idempotencyKey } },
        }),
      ),
    onSuccess: (booking) => {
      queryClient.setQueryData(customerKeys.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export type CheckoutResult = PaymentVerification;

/**
 * Payment steps for a held booking. `initiate` creates (or reuses) the provider order;
 * `verify` settles it with what the provider's checkout returned.
 */
export const payments = {
  initiate: (bookingId: string, idempotencyKey: string): Promise<PaymentOrder> =>
    unwrap(
      api('customer').POST('/api/v1/payments/initiate', { params: { header: { 'Idempotency-Key': idempotencyKey } }, body: { bookingId } }),
    ),
  /** Dev-only fake provider: returns exactly what the browser checkout would. */
  fakeComplete: (orderId: string): Promise<CheckoutConfirmation> =>
    unwrap(api('customer').POST('/api/v1/payments/fake/complete', { body: { orderId } })),
  verify: (confirmation: CheckoutConfirmation): Promise<PaymentVerification> =>
    unwrap(api('customer').POST('/api/v1/payments/verify', { body: confirmation })),
};

export function usePaymentSettled() {
  const queryClient = useQueryClient();
  return useCallback(
    (booking: Booking) => {
      queryClient.setQueryData(customerKeys.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    [queryClient],
  );
}

export { newIdempotencyKey };
export type { SeatMap };

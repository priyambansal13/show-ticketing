'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import type {
  BookingStatus,
  EventInput,
  EventUpdate,
  HallInput,
  LayoutInput,
  ManagerShowsQuery,
  SalesQuery,
  ShowInput,
  ShowUpdate,
  VenueInput,
  VenueUpdate,
} from '@/lib/api/types';

/** Manager portal data: every call carries the manager session's access token. */
const client = () => api('manager');

export const managerKeys = {
  all: ['manager'] as const,
  venues: (page: number) => ['manager', 'venues', page] as const,
  venue: (id: string) => ['manager', 'venue', id] as const,
  layout: (venueId: string, hallId: string) => ['manager', 'layout', venueId, hallId] as const,
  events: (page: number) => ['manager', 'events', page] as const,
  event: (id: string) => ['manager', 'event', id] as const,
  shows: (query: ManagerShowsQuery) => ['manager', 'shows', query] as const,
  show: (id: string) => ['manager', 'show', id] as const,
  showBookings: (id: string, page: number, status?: BookingStatus) => ['manager', 'show-bookings', id, page, status ?? 'ALL'] as const,
  sales: (query: SalesQuery) => ['manager', 'sales', query] as const,
};

// ── Venues & layouts ──────────────────────────────────────────────────────
export function useVenues(page = 1, limit = 20) {
  return useQuery({
    queryKey: [...managerKeys.venues(page), limit],
    queryFn: () => unwrap(client().GET('/api/v1/manager/venues', { params: { query: { page, limit } } })),
    placeholderData: keepPreviousData,
  });
}

export function useVenue(id: string) {
  return useQuery({
    queryKey: managerKeys.venue(id),
    queryFn: () => unwrap(client().GET('/api/v1/manager/venues/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useCreateVenue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VenueInput) => unwrap(client().POST('/api/v1/manager/venues', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manager', 'venues'] }),
  });
}

export function useUpdateVenue(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VenueUpdate) => unwrap(client().PATCH('/api/v1/manager/venues/{id}', { params: { path: { id } }, body })),
    onSuccess: (venue) => {
      queryClient.setQueryData(managerKeys.venue(id), venue);
      void queryClient.invalidateQueries({ queryKey: ['manager', 'venues'] });
    },
  });
}

export function useAddHall(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: HallInput) => unwrap(client().POST('/api/v1/manager/venues/{id}/halls', { params: { path: { id } }, body })),
    onSuccess: (venue) => {
      queryClient.setQueryData(managerKeys.venue(id), venue);
      void queryClient.invalidateQueries({ queryKey: ['manager', 'venues'] });
    },
  });
}

/** Current layout of a hall, or `null` when none has been saved yet (API 404). */
export function useLayout(venueId: string, hallId: string, enabled = true) {
  return useQuery({
    queryKey: managerKeys.layout(venueId, hallId),
    queryFn: async () => {
      try {
        return await unwrap(
          client().GET('/api/v1/manager/venues/{id}/halls/{hallId}/layout', { params: { path: { id: venueId, hallId } } }),
        );
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    enabled: enabled && Boolean(venueId && hallId),
  });
}

export function useSaveLayout(venueId: string, hallId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LayoutInput) =>
      unwrap(client().PUT('/api/v1/manager/venues/{id}/halls/{hallId}/layout', { params: { path: { id: venueId, hallId } }, body })),
    onSuccess: (layout) => {
      queryClient.setQueryData(managerKeys.layout(venueId, hallId), layout);
      void queryClient.invalidateQueries({ queryKey: managerKeys.venue(venueId) });
    },
  });
}

// ── Events ────────────────────────────────────────────────────────────────
export function useManagerEvents(page = 1, limit = 20) {
  return useQuery({
    queryKey: [...managerKeys.events(page), limit],
    queryFn: () => unwrap(client().GET('/api/v1/manager/events', { params: { query: { page, limit } } })),
    placeholderData: keepPreviousData,
  });
}

export function useManagerEvent(id: string) {
  return useQuery({
    queryKey: managerKeys.event(id),
    queryFn: () => unwrap(client().GET('/api/v1/manager/events/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EventInput) => unwrap(client().POST('/api/v1/manager/events', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manager', 'events'] }),
  });
}

export function useUpdateEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EventUpdate) => unwrap(client().PATCH('/api/v1/manager/events/{id}', { params: { path: { id } }, body })),
    onSuccess: (event) => {
      queryClient.setQueryData(managerKeys.event(id), event);
      void queryClient.invalidateQueries({ queryKey: ['manager', 'events'] });
    },
  });
}

export function usePublishEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(client().POST('/api/v1/manager/events/{id}/publish', { params: { path: { id } } })),
    onSuccess: (event) => {
      queryClient.setQueryData(managerKeys.event(id), event);
      void queryClient.invalidateQueries({ queryKey: ['manager', 'events'] });
    },
  });
}

// ── Shows ─────────────────────────────────────────────────────────────────
export function useManagerShows(query: ManagerShowsQuery) {
  return useQuery({
    queryKey: managerKeys.shows(query),
    queryFn: () => unwrap(client().GET('/api/v1/manager/shows', { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

export function useManagerShow(id: string) {
  return useQuery({
    queryKey: managerKeys.show(id),
    queryFn: () => unwrap(client().GET('/api/v1/manager/shows/{id}', { params: { path: { id } } })),
    enabled: Boolean(id),
  });
}

export function useCreateShow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ShowInput) => unwrap(client().POST('/api/v1/manager/shows', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manager', 'shows'] }),
  });
}

function useShowMutation<TArgs, TResult>(id: string, fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: managerKeys.show(id) }),
        queryClient.invalidateQueries({ queryKey: ['manager', 'shows'] }),
        queryClient.invalidateQueries({ queryKey: ['manager', 'sales'] }),
      ]),
  });
}

export const useUpdateShow = (id: string) =>
  useShowMutation(id, (body: ShowUpdate) => unwrap(client().PATCH('/api/v1/manager/shows/{id}', { params: { path: { id } }, body })));

export const usePublishShow = (id: string) =>
  useShowMutation(id, () => unwrap(client().POST('/api/v1/manager/shows/{id}/publish', { params: { path: { id } } })));

export const useCancelShow = (id: string) =>
  useShowMutation(id, () => unwrap(client().POST('/api/v1/manager/shows/{id}/cancel', { params: { path: { id } } })));

export const useBlockSeats = (id: string) =>
  useShowMutation(id, ({ seatIds, action }: { seatIds: string[]; action: 'block' | 'unblock' }) =>
    action === 'block'
      ? unwrap(client().POST('/api/v1/manager/shows/{id}/seats/block', { params: { path: { id } }, body: { seatIds } }))
      : unwrap(client().POST('/api/v1/manager/shows/{id}/seats/unblock', { params: { path: { id } }, body: { seatIds } })),
  );

export function useShowBookings(id: string, page: number, status?: BookingStatus, limit = 20) {
  return useQuery({
    queryKey: [...managerKeys.showBookings(id, page, status), limit],
    queryFn: () =>
      unwrap(
        client().GET('/api/v1/manager/shows/{id}/bookings', {
          params: { path: { id }, query: { page, limit, ...(status ? { status } : {}) } },
        }),
      ),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

// ── Operations ────────────────────────────────────────────────────────────
export function useSalesReport(query: SalesQuery) {
  return useQuery({
    queryKey: managerKeys.sales(query),
    queryFn: () => unwrap(client().GET('/api/v1/manager/reports/sales', { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

export function useVerifyTicket() {
  return useMutation({
    mutationFn: (code: string) => unwrap(client().POST('/api/v1/manager/tickets/verify', { body: { code } })),
  });
}

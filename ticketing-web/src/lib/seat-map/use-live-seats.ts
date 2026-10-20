'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { customerKeys } from '@/lib/api/hooks/customer';
import type { SeatMap } from '@/lib/api/types';
import { SOCKET_URL } from '@/lib/config';
import { applySeatUpdates, type SeatUpdate } from './seat-map';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to `seats:update` for one show (namespace /seats, room show:<id>) and merges updates
 * into the seat-map query cache, batched per animation frame so a burst of holds re-renders once.
 * On every (re)connect the map is refetched after joining, since updates sent before the join are lost.
 */
export function useLiveSeats(showId: string, onUpdates?: (updates: SeatUpdate[]) => void): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const onUpdatesRef = useRef(onUpdates);
  useEffect(() => {
    onUpdatesRef.current = onUpdates;
  }, [onUpdates]);

  useEffect(() => {
    const socket: Socket = io(`${SOCKET_URL}/seats`, { transports: ['websocket'], reconnectionDelayMax: 10_000 });
    let pending: SeatUpdate[] = [];
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      const batch = pending;
      pending = [];
      queryClient.setQueryData<SeatMap>(customerKeys.seatMap(showId), (map) => (map ? applySeatUpdates(map, batch) : map));
      onUpdatesRef.current?.(batch);
    };

    // Join first, then refetch: updates sent before the join (or while the cached map was stale) are
    // covered by the fresh snapshot, and everything after arrives over the socket.
    socket.on('connect', () => {
      socket.emit('show:join', showId);
      setStatus('live');
      void queryClient.invalidateQueries({ queryKey: customerKeys.seatMap(showId) });
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on('seats:update', (update: SeatUpdate) => {
      if (update?.showId !== showId || !Array.isArray(update.seatIds)) return;
      pending.push(update);
      frame ??= requestAnimationFrame(flush);
    });

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      socket.emit('show:leave', showId);
      socket.disconnect();
    };
  }, [showId, queryClient]);

  return status;
}

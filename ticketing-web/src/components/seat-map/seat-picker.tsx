'use client';

import { Minus, Plus, Wifi, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState, Notice, Skeleton } from '@/components/ui/feedback';
import { FormError } from '@/components/ui/field';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { shouldRotateIdempotencyKey } from '@/lib/api/client';
import { newIdempotencyKey, useHoldSeats, useSeatMap } from '@/lib/api/hooks/customer';
import { getSession } from '@/lib/auth/session';
import { MAX_SEATS_PER_BOOKING } from '@/lib/config';
import { formatMoney } from '@/lib/format';
import {
  indexSeats,
  isSelectable,
  reconcileSelection,
  seatLabel,
  selectionTotal,
  type SeatInfo,
  type SeatUpdate,
} from '@/lib/seat-map/seat-map';
import { useLiveSeats } from '@/lib/seat-map/use-live-seats';
import { SeatGrid, SeatLegend } from './seat-grid';

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5];
const selectionKey = (showId: string) => `bms:selection:${showId}`;

export function SeatPicker({ showId }: { showId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: map, isPending, isError, error, refetch } = useSeatMap(showId);
  const hold = useHoldSeats();
  const [selected, setSelected] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  // Same selection retried after a network error reuses its key; a new selection gets a new one.
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  /** True from the hold request until we leave the page: live updates for our own seats are expected. */
  const holdingRef = useRef(false);

  const index = useMemo(() => (map ? indexSeats(map) : new Map<string, SeatInfo>()), [map]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const labelOf = useCallback(
    (id: string) => {
      const info = index.get(id);
      return info ? seatLabel(info) : id;
    },
    [index],
  );

  // Restore a selection saved before the sign-in redirect.
  useEffect(() => {
    if (!map) return;
    const saved = sessionStorage.getItem(selectionKey(showId));
    if (!saved) return;
    sessionStorage.removeItem(selectionKey(showId));
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    const ids = (Array.isArray(parsed) ? parsed : []).filter((id): id is string => typeof id === 'string');
    const stillFree = ids.filter((id) => {
      const info = index.get(id);
      return info && isSelectable(info.seat, info.section);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after the sign-in round trip
    setSelected(stillFree.slice(0, MAX_SEATS_PER_BOOKING));
    if (stillFree.length < ids.length) setAnnouncement('Some seats you picked earlier were taken while you signed in.');
  }, [map, index, showId]);

  // Whenever the map changes (refetch, reconnect, live update), drop selected seats that are no longer free.
  useEffect(() => {
    if (!map || holdingRef.current) return;
    const { kept, lost } = reconcileSelection(selectedRef.current, index);
    if (lost.length === 0) return;
    selectedRef.current = kept;
    setSelected(kept);
    setAnnouncement(`Seat ${lost.map(labelOf).join(', ')} is no longer available and was removed from your selection.`);
  }, [map, index, labelOf]);

  // First available seat owns the grid's tab stop until the user moves.
  const effectiveFocus = focusId ?? [...index.values()].find((info) => isSelectable(info.seat, info.section))?.seat.id ?? null;

  const onLiveUpdates = useCallback(
    (updates: SeatUpdate[]) => {
      // Our own successful hold is broadcast too; it is not "someone else".
      if (holdingRef.current) return;
      const taken = new Set(updates.filter((update) => update.status === 'UNAVAILABLE').flatMap((update) => update.seatIds));
      const lost = selectedRef.current.filter((id) => taken.has(id));
      if (lost.length === 0) return;
      setSelected((current) => current.filter((id) => !taken.has(id)));
      setAnnouncement(`Seat ${lost.map(labelOf).join(', ')} was just booked by someone else and removed from your selection.`);
    },
    [labelOf],
  );
  const live = useLiveSeats(showId, onLiveUpdates);

  const toggle = useCallback((seatId: string) => {
    setFormError(null);
    const current = selectedRef.current;
    if (!current.includes(seatId) && current.length >= MAX_SEATS_PER_BOOKING) {
      setAnnouncement(`You can book up to ${MAX_SEATS_PER_BOOKING} seats at a time.`);
      return;
    }
    const next = current.includes(seatId) ? current.filter((id) => id !== seatId) : [...current, seatId];
    selectedRef.current = next; // keep rapid consecutive clicks consistent before the next render
    setSelected(next);
  }, []);

  const proceed = async () => {
    setFormError(null);
    const session = getSession('customer');
    const { status } = await session.restore().catch(() => ({ status: 'anonymous' as const }));
    if (status !== 'authenticated') {
      sessionStorage.setItem(selectionKey(showId), JSON.stringify(selected));
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    // Sorted, so the same seats always produce the same body for the same key.
    const seatIds = [...selected].sort();
    const signature = seatIds.join(',');
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    holdingRef.current = true;
    try {
      const booking = await hold.mutateAsync({ showId, seatIds, idempotencyKey: attempt.current.key });
      // Next keeps this page mounted (hidden) for back/forward and "Change seats": start fresh there, so
      // the next hold gets a new key and live updates/reconciliation work again.
      attempt.current = null;
      selectedRef.current = [];
      setSelected([]);
      holdingRef.current = false;
      router.push(`/checkout/${booking.id}`);
    } catch (holdError) {
      holdingRef.current = false;
      if (shouldRotateIdempotencyKey(holdError)) attempt.current = null;
      if (isApiError(holdError) && holdError.code === 'SEATS_UNAVAILABLE') void refetch();
      setFormError(errorMessage(holdError));
    }
  };

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (isError || !map) {
    return (
      <ErrorState
        title="Could not load seats"
        message={errorMessage(error)}
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  const total = selectionTotal(selected, index);
  const scale = ZOOM_STEPS[zoom] ?? 1;

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SeatLegend />
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            {live === 'live' ? <Wifi aria-hidden className="text-success size-3.5" /> : <WifiOff aria-hidden className="size-3.5" />}
            {live === 'live' ? 'Live updates on' : live === 'connecting' ? 'Connecting…' : 'Live updates paused'}
          </span>
          <span>{map.availableSeats} seats left</span>
        </div>
      </div>

      {!map.salesOpen ? <Notice tone="warning">Ticket sales for this show are closed. You can still look at the seat map.</Notice> : null}
      {announcement ? <Notice tone="warning">{announcement}</Notice> : null}

      <div className="relative rounded-lg border">
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Zoom out"
            disabled={zoom === 0}
            onClick={() => setZoom((step) => step - 1)}
          >
            <Minus aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Zoom in"
            disabled={zoom === ZOOM_STEPS.length - 1}
            onClick={() => setZoom((step) => step + 1)}
          >
            <Plus aria-hidden />
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-auto overscroll-contain p-4 pt-12">
          <div className="mx-auto w-max" style={{ zoom: scale }}>
            <div
              aria-hidden
              className="via-muted-foreground/40 mx-auto mb-6 h-2 w-3/4 rounded-full bg-gradient-to-r from-transparent to-transparent"
            />
            <p aria-hidden className="text-muted-foreground mb-6 text-center text-[10px] tracking-[0.3em] uppercase">
              Screen / stage this way
            </p>
            <SeatGrid map={map} selected={selectedSet} onToggle={toggle} focusId={effectiveFocus} onFocusChange={setFocusId} />
          </div>
        </div>
      </div>

      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {selected.length === 0 ? (
              <p className="text-muted-foreground">Select up to {MAX_SEATS_PER_BOOKING} seats.</p>
            ) : (
              <p>
                <span className="font-semibold">
                  {selected.length} {selected.length === 1 ? 'seat' : 'seats'}
                </span>{' '}
                <span className="text-muted-foreground">({selected.map(labelOf).join(', ')})</span> ·{' '}
                <span className="font-semibold">{formatMoney(total, map.currency)}</span>
              </p>
            )}
            <FormError message={formError}>
              {isApiError(hold.error) && hold.error.code === 'TOO_MANY_ACTIVE_HOLDS' ? (
                <>
                  {' '}
                  <Link href="/bookings?status=PENDING" className="font-medium underline">
                    See bookings on hold
                  </Link>
                </>
              ) : null}
            </FormError>
          </div>
          <Button size="lg" disabled={selected.length === 0 || !map.salesOpen} loading={hold.isPending} onClick={() => void proceed()}>
            Proceed to pay
          </Button>
        </div>
      </div>
    </div>
  );
}

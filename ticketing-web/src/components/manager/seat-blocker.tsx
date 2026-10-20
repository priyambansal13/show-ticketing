'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/feedback';
import { FormError } from '@/components/ui/field';
import { api, unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useBlockSeats } from '@/lib/api/hooks/manager';
import type { SeatChangeResult } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { LoadingRows, QueryError } from './page-parts';

/**
 * Block seats (house seats, broken seats) or release them. Uses the show's public seat map, which
 * reports AVAILABLE / UNAVAILABLE only: unavailable seats may be blocked, held or sold, so the API
 * answers with `changed` and `skipped` and we show both.
 */
export function SeatBlocker({ showId }: { showId: string }) {
  const seatMap = useQuery({
    queryKey: ['manager', 'seat-map', showId],
    queryFn: () => unwrap(api().GET('/api/v1/shows/{id}/seats', { params: { path: { id: showId } } })),
  });
  const change = useBlockSeats(showId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ action: 'block' | 'unblock'; data: SeatChangeResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (seatId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });

  const submit = async (action: 'block' | 'unblock') => {
    setError(null);
    setResult(null);
    try {
      const data = await change.mutateAsync({ seatIds: [...selected], action });
      setResult({ action, data });
      setSelected(new Set());
      await seatMap.refetch();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Block or release seats</CardTitle>
        <CardDescription>
          Select seats, then block them (they stop being sold) or release seats you blocked earlier. Held or sold seats are skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {seatMap.isLoading ? (
          <LoadingRows rows={3} label="Loading seats" />
        ) : seatMap.isError || !seatMap.data ? (
          <QueryError error={seatMap.error} onRetry={() => void seatMap.refetch()} />
        ) : (
          <>
            <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="border-success size-4 rounded-sm border" /> Available
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="bg-muted flex size-4 items-center justify-center rounded-sm text-[9px]">
                  ×
                </span>
                Unavailable (blocked, held or sold)
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-sm text-[9px]"
                >
                  ✓
                </span>
                Selected
              </li>
            </ul>
            <div className="max-h-96 overflow-auto rounded-md border p-3">
              {seatMap.data.sections.map((section) => (
                <fieldset key={section.code} className="mb-3">
                  <legend className="text-muted-foreground mb-1 text-xs font-semibold">{section.name}</legend>
                  {section.rows.map((row) => (
                    <div key={row.label} className="mb-1 flex items-center gap-1">
                      <span aria-hidden className="text-muted-foreground w-6 shrink-0 text-right text-[10px]">
                        {row.label}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {row.seats.map((seat) => {
                          if (seat.type === 'GAP') return <span key={seat.id} aria-hidden className="size-6" />;
                          const unavailable = seat.status !== 'AVAILABLE';
                          const isSelected = selected.has(seat.id);
                          return (
                            <button
                              key={seat.id}
                              type="button"
                              aria-pressed={isSelected}
                              aria-label={`Row ${row.label} seat ${seat.number}, ${unavailable ? 'unavailable' : 'available'}`}
                              onClick={() => toggle(seat.id)}
                              className={cn(
                                'flex size-6 items-center justify-center rounded-sm border text-[10px]',
                                unavailable ? 'bg-muted text-muted-foreground border-transparent' : 'border-success',
                                isSelected && 'border-primary bg-primary text-primary-foreground',
                              )}
                            >
                              {isSelected ? '✓' : unavailable ? '×' : seat.number}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
            <p className="text-sm" aria-live="polite">
              {selected.size} seat{selected.size === 1 ? '' : 's'} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={selected.size === 0 || selected.size > 500}
                loading={change.isPending && change.variables?.action === 'block'}
                onClick={() => submit('block')}
              >
                <Lock aria-hidden />
                Block selected
              </Button>
              <Button
                variant="outline"
                disabled={selected.size === 0 || selected.size > 500}
                loading={change.isPending && change.variables?.action === 'unblock'}
                onClick={() => submit('unblock')}
              >
                <LockOpen aria-hidden />
                Release selected
              </Button>
              {selected.size > 0 ? (
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              ) : null}
            </div>
          </>
        )}
        <FormError message={error} />
        <div aria-live="polite">
          {result ? (
            <Notice tone={result.data.changed.length > 0 ? 'success' : 'warning'}>
              {result.action === 'block' ? 'Blocked' : 'Released'} {result.data.changed.length} seat
              {result.data.changed.length === 1 ? '' : 's'}
              {result.data.changed.length > 0 ? ` (${result.data.changed.join(', ')})` : ''}.
              {result.data.skipped.length > 0 ? ` Skipped ${result.data.skipped.join(', ')} — not in a state that allows this.` : ''}
            </Notice>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

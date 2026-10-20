'use client';

import { Accessibility, Check, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { SeatMap, SeatMapSeat, SeatMapSection } from '@/lib/api/types';
import { formatMoney } from '@/lib/format';
import { describeSeat, isSelectable } from '@/lib/seat-map/seat-map';
import { cn } from '@/lib/utils';

interface SeatGridProps {
  map: SeatMap;
  selected: ReadonlySet<string>;
  onToggle: (seatId: string) => void;
  /** Seat that currently owns the roving tab stop. */
  focusId: string | null;
  onFocusChange: (seatId: string) => void;
}

interface GridRow {
  key: string;
  label: string;
  section: SeatMapSection;
  firstOfSection: boolean;
  seats: SeatMapSeat[];
}

/**
 * Seat map as an ARIA grid: one tab stop, arrow keys move between seats (Home/End within a row),
 * Space/Enter toggles. Status is shown by shape + icon + label, never by color alone.
 */
export function SeatGrid({ map, selected, onToggle, focusId, onFocusChange }: SeatGridProps) {
  const rows = useMemo<GridRow[]>(
    () =>
      map.sections.flatMap((section) =>
        section.rows.map((row, index) => ({
          key: `${section.code}-${row.label}`,
          label: row.label,
          section,
          firstOfSection: index === 0,
          seats: [...row.seats].sort((a, b) => a.x - b.x || a.number - b.number),
        })),
      ),
    [map.sections],
  );
  const gridRef = useRef<HTMLDivElement>(null);
  // Read through a ref so moveFocus keeps one identity across live updates (memoized seats stay put).
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const moveFocus = useCallback(
    (rowIndex: number, seatIndex: number, event: KeyboardEvent) => {
      const rows = rowsRef.current;
      const row = rows[rowIndex];
      if (!row) return;
      const seatsOf = (index: number) => rows[index]?.seats.filter((seat) => seat.type !== 'GAP') ?? [];
      const current = seatsOf(rowIndex);
      const position = current.findIndex((seat) => seat.id === row.seats[seatIndex]?.id);
      let target: SeatMapSeat | undefined;
      const nearestIn = (index: number) => {
        const candidates = seatsOf(index);
        const x = row.seats[seatIndex]?.x ?? 0;
        return candidates.reduce<SeatMapSeat | undefined>(
          (best, seat) => (!best || Math.abs(seat.x - x) < Math.abs(best.x - x) ? seat : best),
          undefined,
        );
      };
      switch (event.key) {
        case 'ArrowRight':
          target = current[position + 1];
          break;
        case 'ArrowLeft':
          target = current[position - 1];
          break;
        case 'Home':
          target = current[0];
          break;
        case 'End':
          target = current.at(-1);
          break;
        case 'ArrowDown':
          for (let index = rowIndex + 1; index < rows.length && !target; index++) target = nearestIn(index);
          break;
        case 'ArrowUp':
          for (let index = rowIndex - 1; index >= 0 && !target; index--) target = nearestIn(index);
          break;
        default:
          return;
      }
      event.preventDefault();
      if (!target) return;
      onFocusChange(target.id);
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-seat="${target.id}"]`)?.focus();
    },
    [onFocusChange],
  );

  return (
    <div ref={gridRef} role="grid" aria-label="Seat map" aria-rowcount={rows.length} className="flex w-max flex-col gap-1.5">
      {rows.map((row, rowIndex) => (
        <div key={row.key} role="presentation" className="flex flex-col gap-1.5">
          {row.firstOfSection ? (
            <div role="presentation" className="mt-4 flex items-baseline gap-2 border-b pb-1 first:mt-0">
              <span className="text-sm font-semibold">{row.section.name}</span>
              <span className="text-muted-foreground text-xs">
                {row.section.price ? formatMoney(row.section.price, map.currency) : 'Not on sale'}
              </span>
            </div>
          ) : null}
          <div role="row" aria-rowindex={rowIndex + 1} className="flex items-center gap-1.5">
            <span role="rowheader" className="text-muted-foreground w-6 shrink-0 text-center text-xs font-medium">
              {row.label}
            </span>
            {row.seats.map((seat, seatIndex) =>
              seat.type === 'GAP' ? (
                <span key={seat.id} aria-hidden className="size-8 shrink-0" />
              ) : (
                <Seat
                  key={seat.id}
                  seat={seat}
                  sectionName={row.section.name}
                  price={row.section.price}
                  rowLabel={row.label}
                  currency={map.currency}
                  selected={selected.has(seat.id)}
                  tabbable={focusId === seat.id}
                  onToggle={onToggle}
                  onFocus={onFocusChange}
                  rowIndex={rowIndex}
                  seatIndex={seatIndex}
                  onMove={moveFocus}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SeatProps {
  seat: SeatMapSeat;
  sectionName: string;
  price: string | null;
  rowLabel: string;
  currency: string;
  selected: boolean;
  tabbable: boolean;
  onToggle: (seatId: string) => void;
  onFocus: (seatId: string) => void;
  rowIndex: number;
  seatIndex: number;
  onMove: (rowIndex: number, seatIndex: number, event: KeyboardEvent) => void;
}

const Seat = memo(function Seat({
  seat,
  sectionName,
  price,
  rowLabel,
  currency,
  selected,
  tabbable,
  onToggle,
  onFocus,
  rowIndex,
  seatIndex,
  onMove,
}: SeatProps) {
  const info = { seat, section: { name: sectionName, price }, row: rowLabel };
  const available = isSelectable(seat, info.section);
  const disabled = !available && !selected;
  return (
    <span role="gridcell" className="shrink-0">
      <button
        type="button"
        data-seat={seat.id}
        tabIndex={tabbable ? 0 : -1}
        aria-pressed={selected}
        aria-disabled={disabled || undefined}
        aria-label={describeSeat(info, currency, selected, formatMoney)}
        onClick={() => !disabled && onToggle(seat.id)}
        onFocus={() => onFocus(seat.id)}
        onKeyDown={(event) => onMove(rowIndex, seatIndex, event)}
        className={cn(
          'flex size-8 items-center justify-center rounded-t-lg rounded-b-sm border-2 text-[10px] font-semibold transition-colors',
          selected && 'border-[var(--seat-selected)] bg-[var(--seat-selected)] text-white',
          !selected &&
            available &&
            'hover:bg-success/15 border-[var(--seat-available-border)] bg-[var(--seat-available)] text-[var(--seat-available-border)]',
          disabled && 'cursor-not-allowed border-transparent bg-[var(--seat-unavailable)] text-[var(--seat-unavailable-fg)]',
        )}
      >
        {selected ? (
          <Check aria-hidden className="size-4" />
        ) : disabled ? (
          <X aria-hidden className="size-3.5" />
        ) : seat.type === 'WHEELCHAIR' ? (
          <Accessibility aria-hidden className="size-4" />
        ) : (
          seat.number
        )}
      </button>
    </span>
  );
});

export function SeatLegend() {
  const item = 'flex items-center gap-2';
  const box = 'flex size-6 items-center justify-center rounded-t-md rounded-b-sm border-2 text-[10px]';
  return (
    <ul aria-label="Seat legend" className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
      <li className={item}>
        <span aria-hidden className={cn(box, 'border-[var(--seat-available-border)] text-[var(--seat-available-border)]')}>
          5
        </span>
        Available
      </li>
      <li className={item}>
        <span aria-hidden className={cn(box, 'border-[var(--seat-selected)] bg-[var(--seat-selected)] text-white')}>
          <Check className="size-3.5" />
        </span>
        Selected
      </li>
      <li className={item}>
        <span aria-hidden className={cn(box, 'border-transparent bg-[var(--seat-unavailable)] text-[var(--seat-unavailable-fg)]')}>
          <X className="size-3" />
        </span>
        Unavailable
      </li>
      <li className={item}>
        <span aria-hidden className={cn(box, 'border-[var(--seat-available-border)] text-[var(--seat-available-border)]')}>
          <Accessibility className="size-3.5" />
        </span>
        Wheelchair accessible
      </li>
    </ul>
  );
}

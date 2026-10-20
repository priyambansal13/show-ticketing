import type { SeatMap, SeatMapSeat, SeatMapSection } from '@/lib/api/types';
import { sumMoney } from '@/lib/money';

export type PublicSeatStatus = 'AVAILABLE' | 'UNAVAILABLE';
export interface SeatUpdate {
  showId: string;
  seatIds: string[];
  status: PublicSeatStatus;
}

export interface SeatInfo {
  seat: SeatMapSeat;
  section: SeatMapSection;
  row: string;
}

/** Seat id → seat, section and row label (GAP placeholders excluded). */
export function indexSeats(map: SeatMap): Map<string, SeatInfo> {
  const index = new Map<string, SeatInfo>();
  for (const section of map.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) if (seat.type !== 'GAP') index.set(seat.id, { seat, section, row: row.label });
    }
  }
  return index;
}

export const isSelectable = (seat: SeatMapSeat, section: Pick<SeatMapSection, 'price'>): boolean =>
  seat.type !== 'GAP' && seat.status === 'AVAILABLE' && section.price !== null;

/** Applies a batch of live updates immutably; untouched sections/rows keep their identity (cheap re-render). */
export function applySeatUpdates(map: SeatMap, updates: SeatUpdate[]): SeatMap {
  const next = new Map<string, PublicSeatStatus>();
  for (const update of updates) {
    if (update.showId !== map.showId) continue;
    for (const id of update.seatIds) next.set(id, update.status);
  }
  if (next.size === 0) return map;
  let delta = 0;
  const sections = map.sections.map((section) => {
    let sectionChanged = false;
    const rows = section.rows.map((row) => {
      let rowChanged = false;
      const seats = row.seats.map((seat) => {
        const status = next.get(seat.id);
        if (!status || seat.status === status || seat.type === 'GAP') return seat;
        rowChanged = true;
        delta += status === 'AVAILABLE' ? 1 : -1;
        return { ...seat, status };
      });
      if (!rowChanged) return row;
      sectionChanged = true;
      return { ...row, seats };
    });
    return sectionChanged ? { ...section, rows } : section;
  });
  if (delta === 0 && sections.every((section, index) => section === map.sections[index])) return map;
  return { ...map, sections, availableSeats: Math.max(0, map.availableSeats + delta) };
}

export function selectionTotal(selected: string[], index: Map<string, SeatInfo>): string {
  return sumMoney(selected.map((id) => index.get(id)?.section.price ?? '0.00'));
}

export const seatLabel = (info: SeatInfo): string => `${info.row}${info.seat.number}`;

export function describeSeat(
  info: { seat: SeatMapSeat; section: Pick<SeatMapSection, 'name' | 'price'>; row: string },
  currency: string,
  selected: boolean,
  format: (amount: string, currency: string) => string,
): string {
  const parts = [`Row ${info.row} seat ${info.seat.number}`, info.section.name];
  if (info.section.price) parts.push(format(info.section.price, currency));
  if (info.seat.type === 'WHEELCHAIR') parts.push('wheelchair accessible');
  if (info.seat.type === 'RECLINER') parts.push('recliner');
  parts.push(selected ? 'selected' : info.seat.status === 'AVAILABLE' ? 'available' : 'unavailable');
  return parts.join(', ');
}

/** Splits a selection into seats that are still selectable and seats that were taken meanwhile. */
export function reconcileSelection(selected: string[], index: Map<string, SeatInfo>): { kept: string[]; lost: string[] } {
  const kept: string[] = [];
  const lost: string[] = [];
  for (const id of selected) {
    const info = index.get(id);
    (info && isSelectable(info.seat, info.section) ? kept : lost).push(id);
  }
  return { kept, lost };
}

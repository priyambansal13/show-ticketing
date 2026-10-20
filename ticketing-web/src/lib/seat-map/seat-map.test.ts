import { describe, expect, it } from 'vitest';
import type { SeatMap } from '@/lib/api/types';
import { applySeatUpdates, describeSeat, indexSeats, isSelectable, reconcileSelection, selectionTotal } from './seat-map';

const map: SeatMap = {
  showId: 'a'.repeat(24),
  currency: 'INR',
  salesOpen: true,
  totalSeats: 4,
  availableSeats: 3,
  sections: [
    {
      code: 'GOLD',
      name: 'Gold',
      priceTier: 'GOLD',
      price: '450.00',
      rows: [
        {
          label: 'A',
          seats: [
            { id: 'A1', number: 1, x: 0, y: 0, type: 'REGULAR', status: 'AVAILABLE' },
            { id: 'A-GAP', number: 2, x: 10, y: 0, type: 'GAP', status: null },
            { id: 'A3', number: 3, x: 20, y: 0, type: 'WHEELCHAIR', status: 'AVAILABLE' },
          ],
        },
      ],
    },
    {
      code: 'SILVER',
      name: 'Silver',
      priceTier: 'SILVER',
      price: '199.99',
      rows: [
        {
          label: 'B',
          seats: [
            { id: 'B1', number: 1, x: 0, y: 10, type: 'REGULAR', status: 'AVAILABLE' },
            { id: 'B2', number: 2, x: 10, y: 10, type: 'REGULAR', status: 'UNAVAILABLE' },
          ],
        },
      ],
    },
  ],
};

describe('seat map helpers', () => {
  it('indexes real seats only', () => {
    const index = indexSeats(map);
    expect([...index.keys()]).toEqual(['A1', 'A3', 'B1', 'B2']);
    expect(index.get('B1')?.row).toBe('B');
  });

  it('applies live updates immutably and keeps untouched branches', () => {
    const next = applySeatUpdates(map, [{ showId: map.showId, seatIds: ['A1', 'B2'], status: 'UNAVAILABLE' }]);
    expect(next).not.toBe(map);
    expect(next.sections[0]?.rows[0]?.seats[0]?.status).toBe('UNAVAILABLE');
    expect(next.sections[1]?.rows[0]?.seats[1]).toBe(map.sections[1]?.rows[0]?.seats[1]); // already unavailable
    expect(next.availableSeats).toBe(2);
    expect(map.sections[0]?.rows[0]?.seats[0]?.status).toBe('AVAILABLE');
  });

  it('ignores updates for other shows and no-op updates', () => {
    expect(applySeatUpdates(map, [{ showId: 'b'.repeat(24), seatIds: ['A1'], status: 'UNAVAILABLE' }])).toBe(map);
    expect(applySeatUpdates(map, [{ showId: map.showId, seatIds: ['A1'], status: 'AVAILABLE' }])).toBe(map);
  });

  it('lets the last update in a batch win', () => {
    const next = applySeatUpdates(map, [
      { showId: map.showId, seatIds: ['A1'], status: 'UNAVAILABLE' },
      { showId: map.showId, seatIds: ['A1'], status: 'AVAILABLE' },
    ]);
    expect(next.sections[0]?.rows[0]?.seats[0]?.status).toBe('AVAILABLE');
  });

  it('totals the selection exactly and describes seats for screen readers', () => {
    const index = indexSeats(map);
    expect(selectionTotal(['A1', 'B1'], index)).toBe('649.99');
    const info = index.get('A3');
    expect(info && isSelectable(info.seat, info.section)).toBe(true);
    expect(info && describeSeat(info, 'INR', false, (amount) => `₹${amount}`)).toBe(
      'Row A seat 3, Gold, ₹450.00, wheelchair accessible, available',
    );
  });

  it('reconciles a selection against a refreshed map', () => {
    expect(reconcileSelection(['A1', 'B2', 'ZZ9'], indexSeats(map))).toEqual({ kept: ['A1'], lost: ['B2', 'ZZ9'] });
  });
});

import { describe, expect, it } from 'vitest';
import type { Layout } from '@/lib/api/types';
import {
  buildLayout,
  layoutToDrafts,
  nextSeatType,
  overrideKey,
  priceTiersOf,
  rowLabel,
  toLayoutInput,
  validateDrafts,
  type SectionDraft,
} from './layout-generator';

const section = (over: Partial<SectionDraft> = {}): SectionDraft => ({
  key: 'k',
  code: 'GOLD',
  name: 'Gold',
  priceTier: 'GOLD',
  rows: 3,
  seatsPerRow: 4,
  overrides: {},
  ...over,
});

describe('rowLabel', () => {
  it('counts A…Z then AA…ZZ then AAA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(rowLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

describe('buildLayout', () => {
  it('continues row labels across sections so seat ids are unique hall-wide', () => {
    const built = buildLayout([section({ key: 'a', rows: 20, code: 'SILVER' }), section({ key: 'b', rows: 10 })]);
    const labels = built.sections.flatMap((s) => s.rows.map((r) => r.label));
    expect(labels.slice(18, 22)).toEqual(['S', 'T', 'U', 'V']);
    expect(labels.at(-1)).toBe('AD');
    const ids = built.sections.flatMap((s) => s.rows.flatMap((r) => r.seats.map((seat) => seat.id)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z0-9-]{1,16}$/);
  });

  it('keeps coordinates as integers within 0–1000 and centres narrower sections', () => {
    const built = buildLayout([section({ key: 'a', seatsPerRow: 10, rows: 2 }), section({ key: 'b', code: 'X', seatsPerRow: 4, rows: 2 })]);
    const seats = built.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
    for (const seat of seats) {
      expect(Number.isInteger(seat.x) && Number.isInteger(seat.y)).toBe(true);
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.x).toBeLessThanOrEqual(1000);
      expect(seat.y).toBeGreaterThanOrEqual(0);
      expect(seat.y).toBeLessThanOrEqual(1000);
    }
    expect(seats[0]).toMatchObject({ x: 0, y: 0 });
    expect(built.sections[0]?.rows[0]?.seats.at(-1)?.x).toBe(1000);
    // 4-seat section sits in columns 3..6 of 10
    expect(built.sections[1]?.rows[0]?.seats.map((seat) => seat.column)).toEqual([3, 4, 5, 6]);
    // last row is at the back
    expect(built.sections[1]?.rows.at(-1)?.seats[0]?.y).toBe(1000);
  });

  it('applies type overrides and excludes gaps from the seat count', () => {
    const built = buildLayout([section({ overrides: { [overrideKey(0, 1)]: 'WHEELCHAIR', [overrideKey(0, 2)]: 'GAP' } })]);
    expect(built.sections[0]?.rows[0]?.seats.slice(0, 3).map((seat) => seat.type)).toEqual(['WHEELCHAIR', 'GAP', 'REGULAR']);
    expect(built.seatCount).toBe(11);
  });

  it('serializes to the API body without builder-only fields', () => {
    const body = toLayoutInput(buildLayout([section({ rows: 1, seatsPerRow: 2 })]));
    expect(body).toEqual({
      sections: [
        {
          code: 'GOLD',
          name: 'Gold',
          priceTier: 'GOLD',
          rows: [
            {
              label: 'A',
              seats: [
                { id: 'A1', number: 1, x: 0, y: 0, type: 'REGULAR' },
                { id: 'A2', number: 2, x: 1000, y: 0, type: 'REGULAR' },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe('validateDrafts', () => {
  it('accepts a valid layout', () => {
    expect(validateDrafts([section()])).toEqual([]);
  });

  it('reports bad codes, duplicates, limits and empty layouts', () => {
    expect(validateDrafts([])).toContain('Add at least one section.');
    const problems = validateDrafts([
      section({ code: 'gold' }),
      section({ code: 'SILVER', rows: 101 }),
      section({ code: 'SILVER', seatsPerRow: 0 }),
    ]);
    expect(problems.some((p) => p.includes('code must be UPPER_SNAKE'))).toBe(true);
    expect(problems.some((p) => p.includes('rows must be between 1 and 100'))).toBe(true);
    expect(problems.some((p) => p.includes('seats per row must be between 1 and 200'))).toBe(true);
    expect(problems).toContain('Section code "SILVER" is used twice.');
    const allGaps = section({ rows: 1, seatsPerRow: 1, overrides: { [overrideKey(0, 1)]: 'GAP' } });
    expect(validateDrafts([allGaps])).toContain('The layout has no bookable seats.');
  });
});

describe('round trip and helpers', () => {
  it('rebuilds drafts from a saved layout, keeping overrides', () => {
    const saved: Layout = {
      id: 'l',
      venueId: 'v',
      hallId: 'audi-1',
      version: 2,
      totalSeats: 3,
      ...toLayoutInput(buildLayout([section({ rows: 2, seatsPerRow: 2, overrides: { [overrideKey(1, 2)]: 'RECLINER' } })])),
    } as Layout;
    const [draft] = layoutToDrafts(saved);
    expect(draft).toMatchObject({ code: 'GOLD', rows: 2, seatsPerRow: 2, overrides: { '1:2': 'RECLINER' } });
    expect(priceTiersOf(saved)).toEqual(['GOLD']);
  });

  it('cycles seat types', () => {
    expect(nextSeatType('REGULAR')).toBe('RECLINER');
    expect(nextSeatType('GAP')).toBe('REGULAR');
  });
});

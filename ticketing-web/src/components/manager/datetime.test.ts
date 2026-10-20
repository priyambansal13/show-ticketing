import { describe, expect, it } from 'vitest';
import { isoToIstLocal, istLocalToIso } from './datetime';

describe('IST datetime-local conversion', () => {
  it('appends the IST offset', () => {
    expect(istLocalToIso('2026-12-01T18:00')).toBe('2026-12-01T18:00:00+05:30');
    expect(new Date(istLocalToIso('2026-12-01T18:00')).toISOString()).toBe('2026-12-01T12:30:00.000Z');
  });

  it('round-trips through UTC instants, including across midnight', () => {
    expect(isoToIstLocal('2026-12-01T12:30:00.000Z')).toBe('2026-12-01T18:00');
    expect(isoToIstLocal('2026-12-01T20:00:00.000Z')).toBe('2026-12-02T01:30');
    expect(isoToIstLocal(istLocalToIso('2026-01-31T23:59'))).toBe('2026-01-31T23:59');
  });
});

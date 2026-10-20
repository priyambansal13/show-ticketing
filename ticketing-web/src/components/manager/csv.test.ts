import { describe, expect, it } from 'vitest';
import type { SalesReport } from '@/lib/api/types';
import { csvField, salesReportCsv, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });

  it('neutralizes spreadsheet formulas in text cells', () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    // numbers stay numbers
    expect(csvField(-5)).toBe('-5');
  });

  it('joins rows with CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        [1, 2],
      ]),
    ).toBe('a,b\r\n1,2');
  });

  it('exports one line per show after the header', () => {
    const report: SalesReport = {
      totals: { shows: 1, seatsSold: 2, confirmedBookings: 1, grossRevenue: '900.00', refunded: '0.00', netRevenue: '900.00' },
      shows: [
        {
          show: {
            showId: 's1',
            eventId: 'e1',
            eventTitle: '=Dune, Part Two',
            posterUrl: null,
            venueName: 'PVR',
            city: 'bengaluru',
            hallName: 'Audi 1',
            startsAt: '2026-12-01T12:30:00.000Z',
            showStatus: 'ON_SALE',
          },
          seats: { total: 100, sold: 2, held: 0, blocked: 1 },
          occupancyPercent: 2,
          bookings: { confirmed: 1, cancelled: 0 },
          grossRevenue: '900.00',
          refunded: '0.00',
          netRevenue: '900.00',
        },
      ],
    };
    const lines = salesReportCsv(report).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith(`"'=Dune, Part Two",PVR,Audi 1,bengaluru,`)).toBe(true);
    expect(lines[1]?.endsWith(',100,2,0,1,2,1,0,900.00,0.00,900.00')).toBe(true);
  });
});

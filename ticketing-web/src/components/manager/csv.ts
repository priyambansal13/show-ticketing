import type { SalesReport } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

/**
 * RFC 4180 field escaping plus spreadsheet formula-injection defence: a text cell starting with
 * = + - @ (or tab / carriage return) is prefixed with an apostrophe so Excel/Sheets treat it as text.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

export const SALES_CSV_HEADER = [
  'Event',
  'Venue',
  'Hall',
  'City',
  'Starts at (IST)',
  'Show status',
  'Seats total',
  'Seats sold',
  'Seats held',
  'Seats blocked',
  'Occupancy %',
  'Confirmed bookings',
  'Cancelled bookings',
  'Gross revenue',
  'Refunded',
  'Net revenue',
];

export function salesReportCsv(report: SalesReport): string {
  return toCsv([
    SALES_CSV_HEADER,
    ...report.shows.map((row) => [
      row.show.eventTitle,
      row.show.venueName,
      row.show.hallName,
      row.show.city,
      formatDateTime(row.show.startsAt),
      row.show.showStatus,
      row.seats.total,
      row.seats.sold,
      row.seats.held,
      row.seats.blocked,
      row.occupancyPercent,
      row.bookings.confirmed,
      row.bookings.cancelled,
      row.grossRevenue,
      row.refunded,
      row.netRevenue,
    ]),
  ]);
}

/** Saves text as a file in the browser (UTF-8 BOM so Excel detects the encoding). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

import { BUSINESS_TIME_ZONE } from '@/lib/format';

/**
 * `<input type="datetime-local">` values are wall-clock times with no zone. Managers schedule in
 * India, so they are interpreted as IST (UTC+05:30, no DST) regardless of the browser's zone.
 */
const IST_OFFSET = '+05:30';

/** "2026-12-01T18:00" (IST wall clock) → "2026-12-01T18:00:00+05:30" */
export const istLocalToIso = (local: string): string => `${local}:00${IST_OFFSET}`;

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO instant → "YYYY-MM-DDTHH:mm" in IST, for prefilling datetime-local inputs. */
export function isoToIstLocal(iso: string): string {
  const map = Object.fromEntries(parts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

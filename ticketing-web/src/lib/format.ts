/**
 * Display formatting. Money arrives as exact decimal strings ("450.00") and is never parsed into
 * arithmetic here — only formatted. Venues are in India, so times render in IST (the API's
 * business timezone) regardless of the viewer's clock.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string | number, currency = 'INR'): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(typeof amount === 'string' ? Number(amount) : amount);
}

const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeOnly = new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const formatDateTime = (iso: string | Date): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string | Date): string => dateOnly.format(new Date(iso));
export const formatTime = (iso: string | Date): string => timeOnly.format(new Date(iso));
/** Calendar day (YYYY-MM-DD) in IST — the format the API's `date` filters expect. */
export const toIsoDay = (value: string | Date): string => isoDay.format(new Date(value));

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
}

/** "bengaluru" → "Bengaluru", "new-delhi" → "New Delhi" */
export const cityLabel = (slug: string): string =>
  slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

/** Rupees typed by a manager → integer paise for the API. Rejects more than 2 decimals. */
export function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** "450.00" → "450" and "450.50" → "450.50" for editable inputs. */
export const moneyToInput = (amount: string): string => amount.replace(/\.00$/, '');

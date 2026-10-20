/**
 * Customer-facing policy numbers shown in the UI. The API enforces the real values
 * (MAX_SEATS_PER_BOOKING, CANCELLATION_CUTOFF_HOURS, CANCELLATION_FEE_PERCENT); keep these in sync.
 */
const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_SEATS_PER_BOOKING = numberFromEnv(process.env.NEXT_PUBLIC_MAX_SEATS_PER_BOOKING, 10);
export const CANCELLATION_CUTOFF_HOURS = numberFromEnv(process.env.NEXT_PUBLIC_CANCELLATION_CUTOFF_HOURS, 4);
export const CANCELLATION_FEE_PERCENT = numberFromEnv(process.env.NEXT_PUBLIC_CANCELLATION_FEE_PERCENT, 10);
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';
export const IMAGE_HOSTS = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? 'images.unsplash.com')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

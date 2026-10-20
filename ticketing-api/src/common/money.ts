/**
 * Money helpers. Amounts travel as integer minor units (paise) or as exact
 * decimal strings — never as floating-point numbers.
 */

/** 45050 → "450.50" (for numeric(10,2) columns). */
export function minorToDecimalString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError(`amount must be a non-negative safe integer in minor units, got ${minor}`);
  }
  const major = Math.trunc(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `${major}.${fraction}`;
}

/** "450.5" / "450.50" → 45050. Rejects more than two decimal places. */
export function decimalStringToMinor(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new RangeError(`invalid decimal amount "${value}"`);
  }
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`amount "${value}" is too large`);
  }
  return minor;
}

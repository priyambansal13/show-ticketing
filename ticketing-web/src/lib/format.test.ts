import { describe, expect, it } from 'vitest';
import { cityLabel, formatDuration, formatMoney, moneyToInput, rupeesToPaise, toIsoDay } from './format';

describe('format', () => {
  it('formats exact decimal strings as INR', () => {
    expect(formatMoney('450.00')).toBe('₹450.00');
    expect(formatMoney('1234.5')).toBe('₹1,234.50');
  });

  it('converts rupee input to integer paise without float error', () => {
    expect(rupeesToPaise('450')).toBe(45_000);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('19.99')).toBe(1_999);
    expect(rupeesToPaise(' 250.5 ')).toBe(25_050);
  });

  it('rejects malformed rupee input', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1e3', '12345678']) expect(rupeesToPaise(bad)).toBeNull();
  });

  it('uses the IST calendar day', () => {
    // 20:00 UTC is already the next day in India (UTC+05:30).
    expect(toIsoDay('2026-10-11T20:00:00Z')).toBe('2026-10-12');
    expect(toIsoDay('2026-10-11T18:00:00Z')).toBe('2026-10-11');
  });

  it('formats durations, city slugs and money inputs', () => {
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45m');
    expect(cityLabel('new-delhi')).toBe('New Delhi');
    expect(moneyToInput('450.00')).toBe('450');
    expect(moneyToInput('450.50')).toBe('450.50');
  });
});

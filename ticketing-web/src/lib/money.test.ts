import { describe, expect, it } from 'vitest';
import { fromPaise, sumMoney, toPaise } from './money';

describe('money', () => {
  it('round-trips decimal strings through paise', () => {
    expect(toPaise('450.00')).toBe(45_000);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('19.99')).toBe(1_999);
    expect(fromPaise(45_005)).toBe('450.05');
    expect(fromPaise(0)).toBe('0.00');
    expect(fromPaise(-50)).toBe('-0.50');
    expect(fromPaise(-12_345)).toBe('-123.45');
  });

  it('sums without floating point drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(Array.from({ length: 10 }, () => '199.99'))).toBe('1999.90');
    expect(sumMoney([])).toBe('0.00');
  });

  it('rejects malformed amounts', () => {
    expect(() => toPaise('1.234')).toThrow();
    expect(() => toPaise('abc')).toThrow();
  });
});

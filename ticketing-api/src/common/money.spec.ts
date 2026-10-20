import { decimalStringToMinor, minorToDecimalString } from './money.js';

describe('money', () => {
  describe('minorToDecimalString', () => {
    it.each([
      [0, '0.00'],
      [5, '0.05'],
      [100, '1.00'],
      [45050, '450.50'],
      [99999999, '999999.99'],
    ])('%i → %s', (minor, expected) => {
      expect(minorToDecimalString(minor)).toBe(expected);
    });

    it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %d', (minor) => {
      expect(() => minorToDecimalString(minor)).toThrow(RangeError);
    });
  });

  describe('decimalStringToMinor', () => {
    it.each([
      ['0', 0],
      ['1', 100],
      ['450.5', 45050],
      ['450.50', 45050],
      ['0.07', 7],
    ])('%s → %i', (value, expected) => {
      expect(decimalStringToMinor(value)).toBe(expected);
    });

    it.each(['', '-1', '1.234', 'abc', '1e3', '.5', '1.'])('rejects "%s"', (value) => {
      expect(() => decimalStringToMinor(value)).toThrow(RangeError);
    });

    it('rejects amounts beyond safe integer range', () => {
      expect(() => decimalStringToMinor('999999999999999999')).toThrow(RangeError);
    });

    it('round-trips', () => {
      for (const minor of [0, 1, 99, 100, 12345, 7654321]) {
        expect(decimalStringToMinor(minorToDecimalString(minor))).toBe(minor);
      }
    });
  });
});

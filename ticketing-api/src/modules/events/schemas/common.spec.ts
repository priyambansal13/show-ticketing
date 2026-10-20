import { fieldsTouchedByUpdate, maxItems, UUID_PATTERN } from './common.js';

describe('fieldsTouchedByUpdate', () => {
  const guarded = ['startsAt', 'sections'] as const;

  it.each([
    [{ $set: { startsAt: new Date() } }, ['startsAt']],
    [{ startsAt: new Date() }, ['startsAt']],
    [{ $push: { sections: {} } }, ['sections']],
    [{ $set: { 'sections.0.name': 'x' } }, ['sections']],
    [{ $set: { status: 'CANCELLED' }, $inc: { version: 1 } }, []],
    [{ $set: { startsAtLabel: 'x' } }, []],
    [null, []],
    ['not-an-object', []],
  ])('%j → %j', (update, expected) => {
    expect(fieldsTouchedByUpdate(update, guarded)).toEqual(expected);
  });
});

describe('maxItems', () => {
  it('accepts up to the limit and rejects beyond it', () => {
    const rule = maxItems(2, 'tags');
    expect(rule.validator([1, 2])).toBe(true);
    expect(rule.validator([1, 2, 3])).toBe(false);
    expect(rule.message).toBe('tags may contain at most 2 items');
  });
});

describe('UUID_PATTERN', () => {
  it('matches lower-case UUIDs only', () => {
    expect(UUID_PATTERN.test('0199c3c0-0000-7000-8000-000000000001')).toBe(true);
    expect(UUID_PATTERN.test('0199C3C0-0000-7000-8000-000000000001')).toBe(false);
    expect(UUID_PATTERN.test('not-a-uuid')).toBe(false);
  });
});

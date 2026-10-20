import { describe, expect, it } from 'vitest';
import { safeNextPath } from './portals';

describe('safeNextPath', () => {
  it('keeps same-site paths inside the portal', () => {
    expect(safeNextPath('/shows/abc/seats?x=1#top', 'customer')).toBe('/shows/abc/seats?x=1#top');
    expect(safeNextPath('/manager/venues', 'manager')).toBe('/manager/venues');
    expect(safeNextPath('/admin/managers', 'admin')).toBe('/admin/managers');
  });

  it.each([
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    '/..//evil.com',
    '/.//evil.com',
    '/a/../..//evil.com',
    '/%2e%2e//evil.com',
    'https://evil.com',
    '',
    null,
  ])('rejects off-site or malformed target %j', (next) => {
    expect(safeNextPath(next, 'customer')).toBe('/');
  });

  it('keeps encoded slashes as a harmless path', () => {
    expect(safeNextPath('/%2F%2Fevil.com', 'customer')).toBe('/%2F%2Fevil.com');
  });

  it('does not cross portals', () => {
    expect(safeNextPath('/manager/venues', 'customer')).toBe('/');
    expect(safeNextPath('/managerial', 'manager')).toBe('/manager/dashboard');
    expect(safeNextPath('/bookings', 'admin')).toBe('/admin/managers');
  });
});

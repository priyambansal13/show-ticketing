import { describe, expect, it } from 'vitest';
import { parseBrowseParams } from './browse';

describe('parseBrowseParams', () => {
  it('keeps valid filters', () => {
    expect(parseBrowseParams({ q: 'jazz', city: 'Bengaluru', category: 'CONCERT', date: '2026-10-20', page: '2' })).toEqual({
      q: 'jazz',
      city: 'bengaluru',
      category: 'CONCERT',
      date: '2026-10-20',
      page: 2,
      limit: 20,
    });
  });

  it('drops invalid values instead of failing the page', () => {
    expect(parseBrowseParams({ q: 'a', city: '../etc', category: 'OPERA', date: 'tomorrow', page: '-3' })).toEqual({ page: 1, limit: 20 });
  });

  it('takes the first value of repeated params', () => {
    expect(parseBrowseParams({ category: ['PLAY', 'MOVIE'] })).toMatchObject({ category: 'PLAY' });
  });
});

import { expect, it } from 'vitest';
import { tripDates } from './dates.js';

it('labels every day through the return date using Japanese public holidays', () => {
  expect(tripDates({ departureDate: '2026-11-22', returnDate: '2026-11-24' })).toEqual([
    '2026-11-22 Sun', '2026-11-23 Mon (public holiday)', '2026-11-24 Tue',
  ]);
  expect(tripDates({ departureDate: '2026-11-22' })).toEqual(['2026-11-22 Sun']);
  expect(tripDates({})).toEqual([]);
});

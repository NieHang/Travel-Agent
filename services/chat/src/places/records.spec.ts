import { librarySchema, type PlaceRecordInput } from './record.js';
import { records, source } from '../../test/fixtures/place-records.js';
import { closureApplies } from './check.js';
import { lintRecords } from './lint.js';

vi.mock('./records/holidays.js', () => ({ holidays: { coverage: { from: '2026-01-01', until: '2026-12-31' }, dates: ['2026-12-07'] } }));
const [temple, shrine] = records;
it('rejects duplicate slugs, normalized aliases, overlapping or incomplete schedules and backwards works', () => {
  expect(librarySchema.safeParse(records).success).toBe(true);
  const invalid = [
    [temple, { ...shrine, slug: temple.slug }],
    [temple, { ...shrine, aliases: ['HIGASHI HONGAN JI'] }],
    [{ ...temple, hours: [temple.hours, temple.hours] }],
    [{ ...temple, hours: { ...temple.hours, periods: temple.hours.periods.slice(1) } }],
    [{ ...temple, hours: { ...temple.hours, periods: [...temple.hours.periods, temple.hours.periods[0]] } }],
    [{ ...shrine, closures: [{ ...shrine.closures[0], when: { type: 'range', from: '2032-01-01', until: '2031-01-01' } }] }],
  ];
  for (const library of invalid) expect(librarySchema.safeParse(library).success).toBe(false);
});
it('shifts a holiday Monday closure to Tuesday inside holiday coverage and keeps the plain weekday outside it', () => {
  const monday = { type: 'weekly', days: [1], holidayShift: true } satisfies PlaceRecordInput['closures'][number]['when'];
  expect(['2026-12-07', '2026-12-08', '2026-12-09', '2027-01-04'].map(d => closureApplies(monday, d))).toEqual([false, true, false, true]);
  expect(closureApplies({ type: 'holidays' }, '2026-12-07')).toBe(true);
  expect(closureApplies({ ...monday, holidayShift: false }, '2027-01-04')).toBe(true);
});
it('reports overdue sources, ended works and unpinned places independently', () => {
  expect(lintRecords([shrine], '2031-04-01', 180)).toEqual([
    'kofuku: unpinned', 'kofuku: stale fact checked 2026-11-18 ' + source.source, 'kofuku: works ended 2031-03-31 ' + source.source,
  ]);
});

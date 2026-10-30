import { ClassifyEntrySchema, ExtractDaysEntrySchema, readDataset } from './schemas.js';

const entry = {
  id: 'cls-en-01', category: 'partial', locale: 'en', today: '2026-10-30',
  state: { stage: 'idle', requirements: {} }, history: [], text: 'Just me',
  expected: { intent: 'plan', patch: { travelers: 1 }, clarifyField: null },
};

it('keeps sparse expected patches and validates contract value formats', () => {
  expect(ClassifyEntrySchema.parse(entry).expected.patch).toEqual({ travelers: 1 });
  for (const patch of [{ travelers: 0 }, { travelers: 101 }, { budgetCurrency: 'dollars' }, { departureDate: '2026-02-30' }, { budget: -1 }, { invented: true }]) {
    expect(ClassifyEntrySchema.safeParse({ ...entry, expected: { ...entry.expected, patch } }).success).toBe(false);
  }
  expect(ClassifyEntrySchema.safeParse({ ...entry, today: '2026-02-30' }).success).toBe(false);
});

it('accepts actual ResultGroup stays and rejects malformed stay input', () => {
  const stays = { panel: 'hotels', items: [] };
  const extraction = { id: 'ext-en-01', category: 'single_city', locale: 'en', today: '2026-10-30', draft: 'Day 1: Park', stays, expected: { days: [{ stops: ['Park'], stayRef: null }] } };
  expect(ExtractDaysEntrySchema.parse(extraction).stays).toEqual(stays);
  expect(ExtractDaysEntrySchema.safeParse({ ...extraction, stays: [] }).success).toBe(false);
});

// readDataset validates every entry and rejects duplicate ids; sizes change as cases are added.
it('validates the checked-in datasets', async () => {
  expect((await readDataset('classify')).length).toBeGreaterThan(0);
  expect((await readDataset('extract-days')).length).toBeGreaterThan(0);
});

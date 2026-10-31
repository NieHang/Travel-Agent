import { readDataset } from './schemas.js';
import { failedItineraryScores } from './evaluators/itinerary.js';

it('has 20 itinerary scenarios retaining every live case in both languages', async () => {
  const entries = await readDataset('itinerary');
  expect(entries).toHaveLength(20);
  expect(entries.filter((entry) => entry.locale === 'zh').every((entry) => 'text' in entry && /[\u3400-\u9fff]/.test(entry.text) && !entry.text.includes('???'))).toBe(true);
  for (const locale of ['zh', 'en'])
    for (const name of ['refused', 'mixed', 'outside-hotel', 'family', 'day-trip', 'hotel-question', 'vague', 'multi-city'])
      expect(entries.some((entry) => entry.id === `l3-${locale}-${name}`)).toBe(true);
  for (const name of ['elderly', 'tight-budget', 'lodging-area', 'lodging-booked'])
    expect(entries.some((entry) => entry.id.endsWith(name))).toBe(true);
  const assertionCount = entries.flatMap((entry) => 'must' in entry ? failedItineraryScores(entry) : []).filter((s) => s.name === 'live_assertion_count').reduce((sum, s) => sum + s.value, 0);
  expect(assertionCount).toBe(52);
});

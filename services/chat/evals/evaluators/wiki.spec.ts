import { initialState } from '../../src/trip/state.js';
import { gradeWiki } from './wiki.js';

const stop = (name: string) => ({ name, note: null, time: null });
const read = (...pages: string[]) => ({ name: 'read_wiki', args: { pages } });
function output(overrides: Partial<Parameters<typeof gradeWiki>[0]> = {}): Parameters<typeof gradeWiki>[0] {
  return {
    effect: 'itinerary', roundsExhausted: false,
    toolCalls: [read('kyoto'), read('kyoto/higashiyama', 'kyoto/kiyomizu-dera', 'kyoto/fushimi-inari-taisha')],
    next: {
      ...initialState(0, 'en'), requirements: { destination: 'Kyoto' },
      days: [
        { title: 'Day 1', body: '', stayRef: null, stops: [stop('Kiyomizu Temple'), stop('Higashiyama'), stop('Lunch in Gion')] },
        { title: 'Day 2', body: '', stayRef: null, stops: [stop('伏见稻荷'), stop('Kyoto')] },
      ],
    },
    ...overrides,
  };
}

it('scores an itinerary that read the city, an area and two place pages', () => {
  expect(gradeWiki(output())).toEqual([
    { name: 'wiki_miss', value: 0 },
    { name: 'rounds_exhausted', value: 0 },
    { name: 'wiki_read', value: 1 },
    { name: 'wiki_depth', value: 2 },
    // Kiyomizu Temple (alias), Higashiyama (area title) and 伏见稻荷 (alias) of five stops; the city and the meal do not match.
    { name: 'wiki_stop_share', value: 0.6 },
  ]);
});

it('counts requested ids that do not exist, once per request', () => {
  const scores = gradeWiki(output({ toolCalls: [read('kyoto', 'kyoto/gion'), read('kyoto/gion', 'kyoto/kinkaku-ji-temple')] }));
  expect(scores).toContainEqual({ name: 'wiki_miss', value: 3 });
  expect(scores).toContainEqual({ name: 'wiki_read', value: 1 });
  expect(scores).toContainEqual({ name: 'wiki_depth', value: 0 });
});

it('scores no read when the model called other tools only, or asked only for missing pages', () => {
  expect(gradeWiki(output({ toolCalls: [{ name: 'load_skill', args: { names: ['japan-travel'] } }] }))).toContainEqual({ name: 'wiki_read', value: 0 });
  expect(gradeWiki(output({ toolCalls: [read('kyoto/gion')] }))).toContainEqual({ name: 'wiki_read', value: 0 });
});

it('counts a place page once however often it is read', () => {
  expect(gradeWiki(output({ toolCalls: [read('osaka/kaiyukan'), read('osaka/kaiyukan', 'osaka')] }))).toContainEqual({ name: 'wiki_depth', value: 1 });
});

it('leaves wiki_read out for a city without a wiki page and wiki_stop_share out without stops', () => {
  const next = { ...output().next, requirements: { destination: 'Fukuoka' }, days: [] };
  expect(gradeWiki(output({ next, toolCalls: [] }))).toEqual([
    { name: 'wiki_miss', value: 0 },
    { name: 'rounds_exhausted', value: 0 },
    { name: 'wiki_depth', value: 0 },
  ]);
});

it('finds a covered city in a multi-city destination or in the day titles', () => {
  const named = { ...output().next, requirements: { destination: '东京和大阪' } };
  expect(gradeWiki(output({ next: named, toolCalls: [] }))).toContainEqual({ name: 'wiki_read', value: 0 });
  const days = [{ title: '第3天 | 东京 → 大阪', body: '', stayRef: null, stops: [] }];
  expect(gradeWiki(output({ next: { ...output().next, requirements: { destination: '日本' }, days }, toolCalls: [read('tokyo', 'osaka')] }))).toContainEqual({ name: 'wiki_read', value: 1 });
});

it('scores only misses and exhausted rounds on an answer turn, and nothing when no model ran', () => {
  expect(gradeWiki(output({ effect: 'answer', roundsExhausted: true, toolCalls: [read('tokyo/senso-ji', 'tokyo/skytree')] }))).toEqual([
    { name: 'wiki_miss', value: 1 },
    { name: 'rounds_exhausted', value: 1 },
  ]);
  expect(gradeWiki(output({ effect: null }))).toEqual([]);
});

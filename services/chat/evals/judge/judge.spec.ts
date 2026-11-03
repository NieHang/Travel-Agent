import { initialState } from '../../src/trip/state.js';
import { ItineraryEntrySchema } from '../schemas.js';
import type { TurnOutput } from '../turn.js';
import { agreement } from './labels.js';
import { criteriaFor } from './rubric.js';
import { renderItem } from './sheet.js';
import { judgeScores, type Verdict } from './verdicts.js';

const entry = ItineraryEntrySchema.parse({ id: 'l3-en-family', today: '2026-10-30', locale: 'en', text: 'Family Osaka trip', history: [], expected: { effect: 'itinerary', nights: 2 }, must: ['Family pacing', 'Mentions a rest stop'] });
const verdict = (criterion: string, v: Verdict['verdict']): Verdict => ({ criterion, verdict: v, reason: `${criterion} ${v}` });
const general = ['fits_party', 'realistic_days', 'hotel_fit', 'no_unsupported_claims', 'useful_content', 'language_quality'];

it('gives refusals no criteria, answers three general ones and plans six, then the item\'s must lines', () => {
  expect(criteriaFor({ ...entry, expected: { effect: null, nights: 0 } })).toEqual([]);
  expect(criteriaFor({ ...entry, expected: { effect: 'answer', nights: 0 } }).map((c) => c.name)).toEqual(['answers_question', 'no_unsupported_claims', 'language_quality', 'must_1', 'must_2']);
  expect(criteriaFor(entry).map((c) => c.name)).toEqual([...general, 'must_1', 'must_2']);
  expect(criteriaFor(entry).at(-1)?.question).toBe('Mentions a rest stop');
});

it('scores each general criterion, the share of must lines and the share overall, leaving n/a out', () => {
  const verdicts = [...general.map((c) => verdict(c, c === 'hotel_fit' ? 'na' : c === 'useful_content' ? 'fail' : 'pass')), verdict('must_1', 'pass'), verdict('must_2', 'fail')];
  const scores = judgeScores(entry, verdicts);
  expect(scores.map((s) => s.name)).not.toContain('judge_hotel_fit');
  expect(scores).toContainEqual({ name: 'judge_useful_content', value: 0, comment: 'useful_content fail' });
  expect(scores).toContainEqual({ name: 'judge_fits_party', value: 1, comment: 'fits_party pass' });
  expect(scores).toContainEqual({ name: 'judge_must', value: 0.5, comment: 'must_1 pass: must_1 pass\nmust_2 fail: must_2 fail' });
  expect(scores).toContainEqual({ name: 'judge_checklist', value: 5 / 7 });
});

it('refuses verdicts that miss or add a criterion', () => {
  const all = [...general, 'must_1', 'must_2'].map((c) => verdict(c, 'pass'));
  expect(() => judgeScores(entry, all.slice(1))).toThrow('verdicts must cover exactly');
  expect(() => judgeScores(entry, [...all.slice(1), verdict('extra', 'pass')])).toThrow('verdicts must cover exactly');
});

it('counts agreement per labelled criterion, groups must lines and lists each disagreement', () => {
  const verdicts = { runName: 'r#1', rubricHash: 'h', judge: 'claude', items: [{ id: 'a', verdicts: [verdict('fits_party', 'pass'), verdict('hotel_fit', 'na'), verdict('must_1', 'pass'), verdict('must_2', 'fail')] }] };
  const labels = { runName: 'r#1', rubricHash: 'h', items: [{ id: 'a', labels: [
    { criterion: 'fits_party', verdict: 'pass' as const }, { criterion: 'hotel_fit', verdict: 'fail' as const, note: 'far away' },
    { criterion: 'must_1', verdict: 'pass' as const }, { criterion: 'must_2', verdict: null, note: 'search to check' },
  ] }] };
  const { rows, disagreements, undecided } = agreement([{ verdicts, labels }]);
  expect(rows).toEqual([{ criterion: 'fits_party', n: 1, agreed: 1 }, { criterion: 'hotel_fit', n: 1, agreed: 0 }, { criterion: 'must', n: 1, agreed: 1 }]);
  expect(disagreements).toEqual([{ runName: 'r#1', id: 'a', criterion: 'hotel_fit', judge: 'na', human: 'fail', reason: 'hotel_fit na', note: 'far away' }]);
  expect(undecided).toEqual([{ runName: 'r#1', id: 'a', criterion: 'must_2', judge: 'fail', human: null, reason: 'must_2 fail', note: 'search to check' }]);
  expect(() => agreement([{ verdicts, labels: { ...labels, items: [{ id: 'a', labels: [{ criterion: 'useful_content', verdict: 'pass' }] }] } }])).toThrow('no judge verdict for useful_content');
});

it('puts the request, the non-skill tool calls, the grounded hotel facts, the draft and the criteria on the sheet', () => {
  const text = (original: string) => ({ original, translation: null });
  const hotel = { ref: 'h1', id: null, title: text('Hotel A'), address: null, price: { amount: 900, currency: 'CNY' }, rating: 4, url: null, image: null, details: [{ label: 'Distance (m)', value: text('87') }], amenities: [text('Elevator')], summary: 'Best pick' };
  const out = {
    next: { ...initialState(0, 'en'), requirements: { destination: 'Osaka', travelers: 4 }, stays: { panel: null, items: [hotel] }, days: [{ title: 'Day 1', stayRef: 'h1', stops: [{ name: 'Osaka Castle', note: null, time: null }] }] },
    loaded: ['japan-osaka'], draft: 'Day 1: Osaka Castle',
    toolCalls: [{ name: 'load_skill', args: { name: 'japan-osaka' } }, { name: 'mcp_rollingGo_searchHotels', args: { place: 'Osaka' } }],
    toolResults: [{ content: JSON.stringify({ message: 'ok', hotels: [{ name: 'Hotel A', distanceInMeters: 2312, tags: ['Twin rooms'] }] }) }],
  } as unknown as TurnOutput;
  const sheet = renderItem(entry, out);
  expect(sheet).toContain('User (en, today 2026-10-30): Family Osaka trip');
  expect(sheet).toContain('Tool calls: mcp_rollingGo_searchHotels {"place":"Osaka"}\n');
  expect(sheet).toContain('Shown results:\n- h1: Hotel A | 900 CNY | no address | rating 4, Distance (m) 87, Elevator; searched distance 2312 m; tags: Twin rooms\n');
  expect(sheet).not.toContain('Best pick');
  expect(sheet).toContain('- Day 1 (stay h1): Osaka Castle');
  expect(sheet).toContain('````\nDay 1: Osaka Castle\n````');
  expect(sheet).toContain('- must_2: Mentions a rest stop');
});

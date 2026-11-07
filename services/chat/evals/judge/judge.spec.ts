import { initialState } from '../../src/trip/state.js';
import { ItineraryEntrySchema } from '../schemas.js';
import type { TurnOutput } from '../turn.js';
import { factCheck } from './facts.js';
import { agreement } from './labels.js';
import { pairwiseOutcomes, type PairwiseFile } from './pairwise.js';
import { criteriaFor } from './rubric.js';
import { renderItem } from './sheet.js';
import { checklistSpots, mergeQueue, pairwiseSpots, type Spot } from './spot-checks.js';
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

it('counts supported facts and lists unsupported and undecided ones with the verdicts citing them', () => {
  const cite = { trial: 'r_1', id: 'a', criterion: 'realistic_days' };
  const fact = (id: string) => ({ id, claim: `${id} claim`, sources: [{ url: 'https://example.com/', look: 'hours' }], cites: [cite] });
  const facts = { rubricHash: 'h', checked: '2026-11-04', facts: [fact('f1'), fact('f2'), fact('f3'), fact('f4')] };
  const checks = { rubricHash: 'h', checks: [
    { fact: 'f1', verdict: 'supported' as const }, { fact: 'f2', verdict: 'unsupported' as const, note: 'page says 17:00' },
    { fact: 'f3', verdict: null, note: 'page will not load' },
  ] };
  expect(factCheck(facts, checks)).toEqual({ checked: 2, supported: 1, doubts: [
    { fact: 'f2', claim: 'f2 claim', verdict: 'unsupported', note: 'page says 17:00', cites: [cite] },
    { fact: 'f3', claim: 'f3 claim', verdict: null, note: 'page will not load', cites: [cite] },
  ] });
  expect(() => factCheck(facts, { ...checks, checks: [{ fact: 'f9', verdict: 'supported' }] })).toThrow('Checked fact f9 is not in facts.json');
});

it('counts a win or loss only when both orders pick the same run, and a tie as half a win', () => {
  // In order 1, x and z show the baseline as A and y shows it as B; order 2 swaps every item.
  const key = { base: 'base#1', candidate: 'cand#1', rubricHash: 'h', aIsBase: { x: true, y: false, z: true } };
  const file = (order: 1 | 2, picks: Record<string, 'A' | 'B' | 'tie'>): PairwiseFile => ({ order, judge: 'claude', items: Object.entries(picks).map(([id, winner]) => ({ id, winner, reason: `${id} ${winner}` })) });
  // x: candidate both times. y: baseline both times. z: always draft A, which is a different run in each order.
  const report = pairwiseOutcomes(key, file(1, { x: 'B', y: 'B', z: 'A' }), file(2, { x: 'A', y: 'A', z: 'A' }));
  expect(report.items.map((i) => [i.id, i.result])).toEqual([['x', 'win'], ['y', 'loss'], ['z', 'tie']]);
  expect(report).toMatchObject({ wins: 1, losses: 1, ties: 1, winRate: 0.5 });
  expect(report.items[0].reasons).toEqual(['x B', 'x A']);
  expect(report.items[2].picks).toEqual(['base', 'candidate']);
  expect(() => pairwiseOutcomes(key, file(2, { x: 'A', y: 'A', z: 'A' }), file(2, { x: 'A', y: 'A', z: 'A' }))).toThrow('Expected the order 1 verdicts');
  expect(() => pairwiseOutcomes(key, file(1, { x: 'A', y: 'A' }), file(2, { x: 'A', y: 'A', z: 'A' }))).toThrow('Order 1 verdicts must cover exactly');
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

it('finds the searched hotel of an English card by its nameEn', () => {
  const text = (original: string) => ({ original, translation: null });
  const hotel = { ref: 'h1', id: null, title: text('Hotel Hankyu RESPIRE OSAKA'), address: null, price: null, rating: null, url: null, image: null, details: [], amenities: [], summary: null };
  const out = {
    next: { ...initialState(0, 'en'), stays: { panel: null, items: [hotel] }, days: [] }, loaded: [], draft: '', toolCalls: [],
    toolResults: [{ content: JSON.stringify({ hotels: [{ name: '阪急大阪龙仕柏酒店', nameEn: 'Hotel Hankyu RESPIRE OSAKA', distanceInMeters: 359, tags: ['提供四人间'] }] }) }],
  } as unknown as TurnOutput;
  expect(renderItem(entry, out)).toContain('- h1: Hotel Hankyu RESPIRE OSAKA | no price | no address | ; searched distance 359 m; tags: 提供四人间');
});

const draft = (text: string) => ({ next: { ...initialState(0, 'en'), days: [] }, loaded: [], draft: text, toolCalls: [], toolResults: [] }) as unknown as TurnOutput;
const scored = (pairs: Record<string, number>) => Object.entries(pairs).map(([name, value]) => ({ name, value, comment: `${name} why` }));
// Always takes the first item left in the pool, so the random picks are the first unflagged items in order.
const first = () => 0;

it('queues judged items where a failed code check meets a passing judge criterion, then three random ones, skipping reviewed items', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const entries = new Map(ids.map((id) => [id, { ...entry, id }]));
  const judged = { judge_realistic_days: 1, judge_fits_party: 0, judge_checklist: 0.5 };
  const run = { runName: 'r#1', items: [
    { id: 'a', output: draft('A'), scores: scored({ pacing_ok: 0, ...judged }) },
    { id: 'b', output: draft('B'), scores: scored({ pacing_ok: 0, judge_realistic_days: 0, judge_checklist: 0 }) },
    { id: 'c', output: draft('C'), scores: scored({ pacing_ok: 1, ...judged }) },
    { id: 'd', output: draft('D'), scores: scored({ invented_hotel: 1, judge_no_unsupported_claims: 1, judge_checklist: 1 }) },
    { id: 'e', output: draft('E'), scores: scored({ pacing_ok: 1, ...judged }) },
    { id: 'f', output: draft('F'), scores: scored({ pacing_ok: 0 }) },
  ] };
  const spots = checklistSpots([run], entries, new Set(['r_1 c']), first);
  expect(spots.map((s) => [s.id, s.why])).toEqual([
    ['a', 'pacing_ok failed, judge passed realistic_days'], ['d', 'invented_hotel failed, judge passed no_unsupported_claims'],
    ['b', 'random pick'], ['e', 'random pick'],
  ]);
  expect(spots[0]).toMatchObject({ kind: 'checklist', source: 'r_1', judge: ['realistic_days pass: judge_realistic_days why', 'fits_party fail: judge_fits_party why'] });
  expect(spots[0].text).toContain('````\nA\n````');
  expect(spots[0].text).not.toContain('Criteria:');
});

it('queues pairwise items whose orders picked differently, with both picks and the outcome', () => {
  const items = ['x', 'y'].map((id) => ({ entry: { ...entry, id }, base: draft(`${id} base`), candidate: draft(`${id} cand`), aIsBase: true }));
  const outcomes = [
    { id: 'x', result: 'tie' as const, picks: ['base', 'tie'] as ['base', 'tie'], reasons: ['x1', 'x2'] as [string, string] },
    { id: 'y', result: 'loss' as const, picks: ['base', 'base'] as ['base', 'base'], reasons: ['y1', 'y2'] as [string, string] },
  ];
  const spots = pairwiseSpots('pw-1', items, outcomes, new Set(), first);
  expect(spots.map((s) => [s.id, s.why])).toEqual([['x', 'orders disagree: base vs tie'], ['y', 'random pick']]);
  expect(spots[0].judge).toEqual(['order 1 (A = base) picked base: x1', 'order 2 (A = candidate) picked tie: x2', 'outcome: tie']);
  expect(spots[0].text).toMatch(/### Base[\s\S]*x base[\s\S]*### Candidate[\s\S]*x cand/);
});

it('keeps reviewed spots and other sources when a compare refills the queue', () => {
  const spot = (source: string, id: string, review: Partial<Spot> = {}): Spot => ({ kind: 'checklist', source, id, why: 'random pick', text: '', judge: [], ...review });
  const queue = [spot('r_1', 'a', { verdict: 'wrong' }), spot('r_1', 'b'), spot('r_1', 'c', { verdict: null, note: 'unsure' }), spot('r_2', 'a')];
  expect(mergeQueue(queue, ['r_1'], [spot('r_1', 'd')]).map((s) => `${s.source} ${s.id}`)).toEqual(['r_1 a', 'r_1 c', 'r_2 a', 'r_1 d']);
});

import { initialState } from '../../src/trip/state.js';
import { ItineraryEntrySchema } from '../schemas.js';
import type { TurnOutput } from '../turn.js';
import { gradeItinerary } from './itinerary.js';
import { groundResults } from '../../src/trip/results.js';

const entry = ItineraryEntrySchema.parse({ id: 'l3-en-family', today: '2026-10-30', locale: 'en', text: 'Family Osaka trip', history: [], expected: { effect: 'itinerary', nights: 2 }, must: ['Family pacing'] });
function output(): TurnOutput {
  return {
    place: undefined,
    classified: { intent: 'plan', locale: 'en', clarify: null, patch: { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null } },
    next: { ...initialState(0, 'en'), stage: 'review', checkedDestination: 'Osaka', requirements: { destination: 'Osaka', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, tripType: 'family' }, days: [0, 1, 2].map((i) => ({ title: `Day ${i + 1}`, stayRef: null, stops: [{ name: 'Osaka Castle', note: null, time: null }] })) },
    effect: 'itinerary', draft: 'Overview\nDay 1\nDay 2\nAlternative: rest\nDay 3\nBefore you go\napprox.',
    loaded: ['japan-osaka'], calls: [], toolCalls: [], toolResults: [],
  };
}
it('does not pass missing stays or night links and catches invented hotel mentions', () => {
  const result = output();
  result.draft += '\nStay at Imaginary Moon Hotel';
  const scores = gradeItinerary(entry, result);
  expect(scores).toContainEqual({ name: 'has_stays', value: 0 });
  expect(scores).toContainEqual({ name: 'every_night_linked', value: 0 });
  expect(scores).toContainEqual({ name: 'invented_hotel', value: 1 });
});
it('checks actual lodging arguments, including travelers and the full date range', () => {
  const result = output();
  result.toolCalls = [{ name: 'mcp_rollingGo_searchHotels', args: { place: 'Osaka', checkInParam: { checkInDate: '2026-12-01', stayNights: 2, adultCount: 4 } } }];
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'tool_args_ok', value: 1 });
  result.toolCalls[0].args.checkInParam = { checkInDate: '2026-12-01', stayNights: 1, adultCount: 2 };
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'tool_args_ok', value: 0 });
});
it('enforces family stop limits and treats travel legs as errors', () => {
  const result = output();
  result.next.days[1].stops = ['A', 'B', 'C', 'D', 'E', 'Shinkansen to Kyoto'].map((name) => ({ name, time: null, note: null }));
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'pacing_ok', value: 0 });
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'leg_as_stop', value: 1 });
});

it.each([
  { tripType: 'couple', stops: ['Ueno Station', 'Ueno Park', 'Ameyoko lunch', 'Ueno Park', 'Tokyo Station Character Street', 'Senso-ji'], expected: 1 },
  { tripType: 'couple', stops: ['Ueno Park', 'Ameyoko lunch', 'Tokyo Station Character Street', 'Senso-ji', 'Nakamise shops'], expected: 0 },
  { tripType: 'family', stops: ['Kansai Airport (KIX)', 'Osaka Castle', 'Kuromon Market', '近铁奈良站'], expected: 1 },
  { tripType: 'family', stops: ['Osaka Castle', 'Kuromon Market', 'Dotonbori dinner', 'Shinsaibashi shops'], expected: 0 },
  { tripType: 'family', stops: ['Osaka Castle Park', 'Lunch near the park', 'Kuromon Market', '东福寺附近', 'Dinner nearby', 'Hotel', 'Dotonbori'], expected: 1 },
] as const)('allows four places a day ($tripType: three), counting restaurants and shops but not stations, nearby meals or repeats: $stops', ({ tripType, stops, expected }) => {
  const result = output();
  result.next.requirements.tripType = tripType;
  result.next.days[1].stops = stops.map((name) => ({ name, time: null, note: null }));
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'pacing_ok', value: expected });
});

function withHotel(result: TurnOutput): TurnOutput {
  result.next.stays = groundResults({ panel: 'hotels', items: [{ source: 'c1', id: '1', title: { original: 'Real Hotel', translation: null }, address: null, price: null, rating: null, url: null, image: 'https://example.com/h.jpg', details: [], amenities: [], summary: null }] }, [{ callId: 'c1', tool: 'searchHotels', args: {}, content: 'Real Hotel 1 https://example.com/h.jpg', isError: false }]);
  result.next.days.forEach((d) => { d.stayRef = 'r1'; });
  result.toolCalls = [{ name: 'mcp_rollingGo_searchHotels', args: { place: 'Osaka', checkInParam: { checkInDate: '2026-12-01', stayNights: 2, adultCount: 4 } } }];
  return result;
}

it('fails the aggregate when a travel leg is extracted, even if every other family check passes', () => {
  const result = withHotel(output());
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'code_checks_pass', value: 1 });
  result.next.days[0].stops[0].name = 'Shinkansen to Kyoto';
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'code_checks_pass', value: 0 });
});

it('does not let a real hotel mask a second invented hotel on the same line', () => {
  const result = withHotel(output());
  result.draft += '\nStay at Real Hotel or Imaginary Moon Hotel';
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 1 });
});

it('accepts a hotel named in tool evidence even when it was not shown as a card', () => {
  const result = output();
  result.draft += '\nStay at Unshown Hotel';
  result.toolResults = [{ callId: 'c1', tool: 'searchHotels', args: {}, content: '{"hotels":[{"name":"Unshown Hotel"}]}', isError: false }];
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

it('reports an uncheckable budget without failing budget or the aggregate', () => {
  const result = withHotel(output());
  result.next.stays!.items[0].price = { amount: 100, currency: 'CNY' };
  const budgetEntry = { ...entry, expected: { ...entry.expected, budget: { amount: 100, currency: 'EUR' } } };
  const scores = gradeItinerary(budgetEntry, result);
  expect(scores).toContainEqual({ name: 'budget_checkable', value: 0 });
  expect(scores.some((s) => s.name === 'budget_ok')).toBe(false);
  expect(scores).toContainEqual({ name: 'code_checks_pass', value: 1 });
});

it.each([{ price: 40, expected: 1 }, { price: 60, expected: 0 }])('grades a checkable budget using price $price times nights', ({ price, expected }) => {
  const result = withHotel(output());
  result.next.stays!.items[0].price = { amount: price, currency: 'CNY' };
  const budgetEntry = { ...entry, expected: { ...entry.expected, budget: { amount: 100, currency: 'CNY' } } };
  expect(gradeItinerary(budgetEntry, result)).toContainEqual({ name: 'budget_ok', value: expected });
});

it.each([
  '11:00 Hotel → Kyoto Station by taxi',
  '总览：京都 3 晚，0 次换酒店',
  '在东京酒店前台安排宅急便，寄到大阪酒店',
  'Overview: Nara day trip, no overnight stay → 0 hotel changes',
  '住宿：东京 3 晚（新宿一带）＋ 大阪 2 晚（难波一带）',
  '住宿：3 晚总预算 1200 CNY，约合每晚 400 CNY；下面推荐的酒店都在预算内',
])('does not treat a generic hotel reference as an invented hotel: %s', (line) => {
  const result = output();
  result.draft = line;
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

it('does not use hotel-like extracted stops as evidence of an invented lodging recommendation', () => {
  const result = output();
  result.next.days[0].stops = [{ name: 'Hotel check-in', note: null, time: null }];
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

it('grounds a per-night translated hotel name through the linked stay original', () => {
  const result = withHotel(output());
  result.next.stays!.items[0].title = { original: 'Hotel Gracery Kyoto Sanjo', translation: null };
  result.draft = 'Day 1\nTonight: Hotel Gracery Kyoto Sanjo (京都三条格拉斯丽酒店)\nDay 2\n今晚：京都三条格拉斯丽酒店（Hotel Gracery Kyoto Sanjo）';
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

it('grounds the original Chinese name with a shorter English alias in parentheses', () => {
  const result = withHotel(output());
  result.next.stays!.items[0].title = { original: '新宿格拉斯丽酒店', translation: null };
  result.draft = 'Day 1\n今晚：新宿格拉斯丽酒店（Gracery Shinjuku）';
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

it('flags an explicit per-night hotel absent from the structured hotel catalog and tools', () => {
  const result = withHotel(output());
  result.draft = 'Day 1\nTonight: Hotel Sakura Palace Kyoto';
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 1 });
});

it.each([
  '京都站附近已订酒店（按你的安排，不另推荐）',
  '住宿已订（京都站附近，无需另订）',
  '已订京都站附近酒店（无需另订）',
  '实时酒店数据暂时不可用，这次没有找到大阪的房源，所以不指定酒店',
  '本次实时酒店数据未返回大阪的住宿选项，因此无法推荐具体酒店',
  '本次未搜到大阪酒店，住宿待定（请自行预订）',
  '大阪段酒店暂无实时数据，请另行查询确认',
  '大阪住宿待定（本次酒店搜索未返回大阪可用结果，请另行确认）',
])('does not flag an existing booking or unavailable lodging as invented: %s', (choice) => {
  const result = output();
  result.draft = `Day 1\n今晚：${choice}`;
  expect(gradeItinerary(entry, result)).toContainEqual({ name: 'invented_hotel', value: 0 });
});

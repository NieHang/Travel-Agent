import { vi } from 'vitest';
import { checkPlan, placeFacts } from './index.js';
import { source, pagoda } from '../../test/fixtures/place-records.js';
import type { Stop } from '../trip/itinerary.js';

// The checks run against fixture records only, so the real library can change without touching these expectations.
vi.mock('./records/kyoto.js', async () => ({ kyoto: (await import('../../test/fixtures/place-records.js')).records }));
vi.mock('./records/nara.js', () => ({ nara: [] }));
vi.mock('./records/osaka.js', () => ({ osaka: [] }));
vi.mock('./records/tokyo.js', () => ({ tokyo: [] }));
vi.mock('./records/holidays.js', () => ({ holidays: { coverage: { from: '2026-01-01', until: '2026-12-31' }, dates: ['2026-12-07'] } }));

function check(name: string, time: string | null = null, note: string | null = null, date: string | undefined = '2026-12-01', following: Stop[] = []) {
  return checkPlan({ requirements: { departureDate: date }, days: [{ title: 'Day 1', body: '', stayRef: null, stops: [{ name, note, time }, ...following] }] }).days[0][0];
}
const rail = { ...source, kind: 'wrong_rail', severity: 'conflict', stated: 'subway', served: ['jr', 'private_rail'] };

describe('audit stops', () => {
  it.each(['16:00', '约 16:00', 'approx. 16:00'])('checks winter visiting time at %s', (time) => {
    expect(check('东本愿寺', time, '从酒店步行前往，离酒店近，傍晚人少，约1小时')).toMatchObject({ findings: [
      { ...source, kind: 'past_closing', severity: 'conflict', closes: '16:30', endsBy: 'stated' },
    ] });
  });
  it('prefers stated end and then the next stop over visit duration', () => {
    expect(check('东本愿寺', '15:00–17:00')).toMatchObject({ findings: [{ kind: 'past_closing', endsBy: 'stated' }] });
    expect(check('东本愿寺', '16:00')).toMatchObject({ findings: [{ kind: 'past_closing', endsBy: 'visit_minutes' }] });
    expect(check('东本愿寺', '15:00', null, '2026-12-01', [{ name: 'Dinner', note: null, time: '17:00' }])).toMatchObject({ findings: [] });
    expect(check('东本愿寺', '16:10', null, '2026-12-01', [{ name: 'Dinner', note: null, time: '16:40' }])).toMatchObject({ findings: [{ kind: 'past_closing', endsBy: 'next_stop' }] });
    expect(check('东本愿寺', '16:00', null, '2026-12-01', [{ name: 'Dinner', note: null, time: '16:20' }])).toMatchObject({ findings: [] });
    expect(check('东本愿寺', '16:00–16:15')).toMatchObject({ findings: [] });
    expect(check('Higashi Hongan-ji', '16:15', 'Walk from Kyoto Station; a short visit before closing, approx. 15 min', '2026-12-01', [{ name: 'Kyoto Station area', note: null, time: '16:45' }])).toMatchObject({ findings: [] });
    expect(check('东本愿寺', '15:30', '步行前往，约 1.5 小时')).toMatchObject({ findings: [{ kind: 'past_closing', endsBy: 'stated' }] });
  });
  it.each(['Morning', '下午', null])('still checks works and rail at %s', (time) => {
    expect(check('Kofuku-ji', time, 'Walk from the station; five-storey pagoda, a short first stop while it is quiet')).toMatchObject({
      findings: [{ ...source, severity: 'conflict', kind: 'works', until: '2031-03-31', part: pagoda }],
    });
    expect(check('兴福寺', time)).toMatchObject({ findings: [{ ...source, severity: 'caution', kind: 'works', until: '2031-03-31', part: pagoda }] });
    expect(check('东本愿寺', time)).toMatchObject({ findings: [] });
    expect(check('Kansai International Airport', time, '乘地铁前往机场')).toMatchObject({ findings: [rail] });
  });
  it('uses winter hours on leap day and changes season on March 1', () => {
    expect(check('东本愿寺', '06:00', null, '2028-02-29')).toMatchObject({ findings: [
      { ...source, kind: 'before_opening', severity: 'conflict', opens: '06:20' },
    ] });
    expect(check('东本愿寺', '06:00', null, '2028-03-01')).toMatchObject({ findings: [] });
  });
  it('uses listed market closure dates', () => {
    expect(check('Tsukiji Outer Market')).toMatchObject({ findings: [{ ...source, kind: 'closed_day', severity: 'caution', scope: { type: 'most_shops' } }] });
    expect(check('Tsukiji Outer Market', '08:00', null, '2026-12-02')).toMatchObject({ findings: [] });
  });
  it.each(['乘地铁前往；清晨人最少，千本鸟居走到一半折返即可，约2小时', 'by subway'])('checks specific rail claims: %s', (note) => {
    expect(check('伏见稻荷大社', null, note)).toMatchObject({ findings: [rail] });
  });
  it.each(['乘电车', 'by train', 'by taxi'])('accepts %s', (note) => {
    expect(check('Fushimi Inari Taisha', null, note)).toMatchObject({ findings: [] });
  });
  it('leaves tied contained aliases and unknown names unmatched', () => {
    expect(check('东本愿寺 & 关西机场')).toEqual({ status: 'unmatched', reason: 'ambiguous' });
    expect(check('Elsewhere')).toEqual({ status: 'unmatched', reason: 'no_match' });
  });
  it('runs only rail checks without a date', () => {
    const stops = [{ name: '东本愿寺', time: '16:00', note: null }, { name: '伏见稻荷大社', time: null, note: 'by subway' }];
    expect(checkPlan({ requirements: {}, days: [{ title: '', body: '', stops, stayRef: null }] }).days[0]).toMatchObject([
      { date: null, findings: [] }, { date: null, findings: [rail] },
    ]);
  });
  it('uses only cities named in the destination and facts applicable on trip dates', () => {
    expect(placeFacts({ destination: 'Kansai' }, 'en')).toEqual([]);
    expect(placeFacts({ destination: 'Tokyo and Nara', departureDate: '2026-11-30', returnDate: '2026-12-01' }, 'en')).toEqual([
      'Kofuku-ji (兴福寺): five-storey pagoda closed until 2031-03-31 on your dates',
      'Tsukiji Outer Market (筑地场外市场): most shops closed on 2026-12-01',
    ]);
    expect(placeFacts({ destination: '京都', departureDate: '2026-12-01', returnDate: '2026-12-01' }, 'en')).toEqual([
      'Higashi Hongan-ji (东本愿寺): open 06:20–16:30 on your dates',
      'Fushimi Inari Taisha (伏见稻荷大社): rail access: JR, private rail',
    ]);
  });
});

it('derives sourced view notes again after the trip date changes', async () => {
  const { initialState, toTripView } = await import('../trip/state.js');
  const state = { ...initialState(), stage: 'review' as const, requirements: { departureDate: '2026-12-01' },
    days: [{ title: 'Day 1', body: '', stayRef: null, stops: [{ name: '东本愿寺', time: '16:00', note: null }] }] };
  expect(toTripView(state)?.days[0].stops[0].check).toEqual({ level: 'conflict', notes: [
    { text: '按预计停留时间推算，这一站会超过 16:30 的关门时间。', source: source.source, checkedOn: '2026-11-18' },
  ] });
  expect(toTripView({ ...state, requirements: { departureDate: '2026-05-01' } })?.days[0].stops[0].check).toEqual({ level: 'ok', notes: [] });
});

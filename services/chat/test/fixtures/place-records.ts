import type { StopCheck } from '../../src/places/index.js';

type PlaceRecordInput = Extract<StopCheck, { status: 'matched' }>['record'];

export const source = { source: 'https://example.org/fixture', quote: 'Fixture excerpt', checkedOn: '2026-11-18' };
export const pagoda = { en: 'five-storey pagoda', zh: '五重塔', ja: '五重塔' };
function place(slug: string, city: PlaceRecordInput['city'], en: string, zh: string): PlaceRecordInput {
  return { slug, city, name: { en, zh, ja: zh }, aliases: [], visitMinutes: 45,
    pin: { status: 'unpinned', query: en }, hours: { type: 'not_recorded' }, closures: [], access: null };
}
const access = { ...source, rail: ['jr', 'private_rail'] } satisfies PlaceRecordInput['access'];
export const records = [
  { ...place('higashi', 'kyoto', 'Higashi Hongan-ji', '东本愿寺'), hours: { ...source, type: 'schedule', periods: [
    { from: '11-01', to: '02-28', open: '06:20', close: '16:30' }, { from: '03-01', to: '10-31', open: '05:50', close: '17:30' },
  ] } },
  { ...place('kofuku', 'nara', 'Kofuku-ji', '兴福寺'), closures: [{ ...source, when: { type: 'range', from: '2024-01-01', until: '2031-03-31' }, scope: { type: 'part', name: pagoda, aliases: [] } }] },
  { ...place('tsukiji', 'tokyo', 'Tsukiji Outer Market', '筑地场外市场'), closures: [{ ...source, when: { type: 'dates', dates: ['2026-12-01'] }, scope: { type: 'most_shops' } }] },
  { ...place('inari', 'kyoto', 'Fushimi Inari Taisha', '伏见稻荷大社'), access },
  { ...place('kansai', 'osaka', 'Kansai International Airport', '关西机场'), access },
] satisfies [PlaceRecordInput, ...PlaceRecordInput[]];

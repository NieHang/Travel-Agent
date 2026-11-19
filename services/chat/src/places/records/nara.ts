import type { PlaceRecordInput } from '../record.js';

// See kyoto.ts for how these records are sourced.
const checkedOn = '2026-11-19';

export const nara = [
  {
    slug: 'kofuku-ji',
    city: 'nara',
    pin: { status: 'pinned', placeId: 'ChIJs-w9sog5AWARk0WDN0cPgxE', pinnedOn: checkedOn },
    name: { en: 'Kofuku-ji', zh: '兴福寺', ja: '興福寺' },
    aliases: ['Kofukuji', 'Kohfukuji'],
    visitMinutes: 60,
    // The halls open 09:00–17:00 all year, but the temple states no hours for the grounds, so nothing is checked against them.
    hours: { type: 'not_recorded' },
    closures: [
      {
        // Month precision on the source: the enclosure was finished in March 2025 and the repair is planned to end in March 2034.
        // The temple's own 2023 notice still says 2031; Nara Prefecture, which carries out the work, says 2034.
        when: { type: 'range', from: '2025-03-31', until: '2034-03-31' },
        scope: { type: 'part', name: { en: 'five-storey pagoda', zh: '五重塔', ja: '五重塔' }, aliases: ['five-storied pagoda', 'five storey pagoda', 'five-story pagoda', 'pagoda'] },
        source: 'https://www.pref.nara.jp/62140.htm',
        quote: '修理期間 令和4年(2022)6月～令和16年(2034)3月',
        checkedOn,
      },
    ],
    access: {
      // JR Nara Station is a 15-minute walk by the temple's own figure.
      rail: ['private_rail', 'jr'],
      source: 'https://www.kohfukuji.com/info/info-access/',
      quote: '近鉄奈良駅 徒歩 約5分 興福寺 / JR奈良駅 徒歩 約15分 興福寺',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

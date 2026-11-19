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
  {
    slug: 'todai-ji',
    city: 'nara',
    pin: { status: 'pinned', placeId: 'ChIJ3XYIepA5AWARjzzVnT-skPg', pinnedOn: checkedOn },
    name: { en: 'Todai-ji', zh: '东大寺', ja: '東大寺' },
    aliases: ['Todaiji', 'Todai-ji Temple', 'Great Buddha Hall', 'Daibutsuden', '大佛殿', '大仏殿'],
    visitMinutes: 90,
    hours: {
      type: 'schedule',
      // The Great Buddha Hall's hours: it is what a stop at Todai-ji visits. The page lists them as a table, seasons across and halls down.
      periods: [
        { from: '04-01', to: '10-31', open: '07:30', close: '17:30' },
        { from: '11-01', to: '03-31', open: '08:00', close: '17:00' },
      ],
      source: 'https://www.todaiji.or.jp/information/haikan/',
      quote: '拝観時間 4月〜10月 11月〜3月 大仏殿 7：30～17：30 8：00～17：00',
      checkedOn,
    },
    closures: [],
    access: {
      // No station is nearby: both railways' Nara stations connect by bus, and the page gives a 20-minute walk from Kintetsu Nara.
      rail: ['private_rail', 'jr'],
      source: 'https://www.todaiji.or.jp/information/access/',
      quote: 'JR奈良駅・近鉄奈良駅から市内循環バス「東大寺大仏殿・春日大社前」下車徒歩5分',
      checkedOn,
    },
  },
  {
    slug: 'kasuga-taisha',
    city: 'nara',
    pin: { status: 'pinned', placeId: 'ChIJ1Wqwa8A5AWARlpXjgoPnl0w', pinnedOn: checkedOn },
    name: { en: 'Kasuga Taisha', zh: '春日大社', ja: '春日大社' },
    aliases: ['Kasuga Grand Shrine', 'Kasuga Shrine', 'Kasuga-taisha'],
    visitMinutes: 60,
    hours: {
      type: 'schedule',
      // The main sanctuary's gate hours. The paid inner visit (9:00–16:00) has its own suspended days, which are not recorded.
      periods: [
        { from: '03-01', to: '10-31', open: '06:30', close: '17:30' },
        { from: '11-01', to: '02-28', open: '07:00', close: '17:00' },
      ],
      source: 'https://www.kasugataisha.or.jp/about/basic/',
      quote: '御本社（大宮）参拝所 3月～10月 6：30～17:30 11月～2月 7：00～17:00',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['jr', 'private_rail'],
      source: 'https://www.kasugataisha.or.jp/about/basic/',
      quote: 'ＪＲ大和路線・近鉄奈良線「奈良駅」から奈良交通バス（春日大社本殿行き）約11～15分、「春日大社本殿」下車すぐ',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

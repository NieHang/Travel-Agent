import type { PlaceRecordInput } from '../record.js';

// See kyoto.ts for how these records are sourced.
const checkedOn = '2026-11-19';

export const osaka = [
  {
    slug: 'osaka-castle-main-tower',
    city: 'osaka',
    pin: { status: 'pinned', placeId: 'ChIJJ_AZutLgAGARwYqBzSs8DkM', pinnedOn: checkedOn },
    // "Osaka Castle" / "大阪城" alone is not an alias: drafts use it for the free park around the tower, which has no hours.
    name: { en: 'Osaka Castle Main Tower', zh: '大阪城天守阁', ja: '大阪城天守閣' },
    aliases: ['Osaka Castle Tower', 'Osaka Castle Museum', 'Osaka Castle keep', 'Tenshukaku', '天守阁', '天守閣'],
    visitMinutes: 90,
    hours: {
      type: 'schedule',
      // Last admission is 17:30. The year-end closure is a separate dated closure below.
      periods: [{ from: '01-01', to: '12-31', open: '09:00', close: '18:00' }],
      source: 'https://www.osakacastle.net/guide/',
      quote: '開館時間 9:00～18:00（入館は17:30まで）',
      checkedOn,
    },
    closures: [
      {
        when: { type: 'dates', dates: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'] },
        scope: { type: 'whole' },
        source: 'https://www.osakacastle.net/guide/',
        quote: '休館日 12月28日～1月1日',
        checkedOn,
      },
    ],
    access: {
      rail: ['subway', 'jr', 'private_rail'],
      source: 'https://www.osakacastle.net/access/',
      quote: '谷町線 「谷町4丁目駅」1-B番出口 「天満橋駅」3番出口 / 大阪環状線 森ノ宮駅 大阪城公園駅 / 京阪電車 天満橋駅',
      checkedOn,
    },
  },
  {
    slug: 'kansai-international-airport',
    city: 'osaka',
    pin: { status: 'pinned', placeId: 'ChIJ9_rNIxO5AGARiI-QjZ-ncfE', pinnedOn: checkedOn },
    name: { en: 'Kansai International Airport', zh: '关西国际机场', ja: '関西国際空港' },
    aliases: ['Kansai Airport', 'KIX', '关西机场', '关空', '関西空港'],
    visitMinutes: 30,
    hours: { type: 'not_recorded' },
    closures: [],
    access: {
      // JR West and Nankai are the only railways at Kansai-Airport Station. The airport page names them through its timetable links and route map.
      rail: ['jr', 'private_rail'],
      source: 'https://www.kansai-airport.or.jp/access/to-airport/train',
      quote: '関西空港駅は 第1ターミナルビル2F 及び エアロプラザビル2F に直結しています。 / JR西日本の時刻表を見る / 南海電鉄の時刻表を見る',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

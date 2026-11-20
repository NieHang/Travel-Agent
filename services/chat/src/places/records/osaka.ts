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
  {
    slug: 'kaiyukan',
    city: 'osaka',
    pin: { status: 'pinned', placeId: 'ChIJzakNjPToAGARzCwIriDFg28', pinnedOn: checkedOn },
    name: { en: 'Osaka Aquarium Kaiyukan', zh: '海游馆', ja: '海遊館' },
    aliases: ['Kaiyukan', 'Osaka Aquarium', '大阪海游馆', '大阪海遊館'],
    visitMinutes: 150,
    // Opening time changes by day (8:30 to 10:30 on a monthly calendar), which a seasonal schedule cannot hold.
    hours: { type: 'not_recorded' },
    closures: [
      {
        // The page names only the next closure; replace it when the following one is announced.
        when: { type: 'dates', dates: ['2027-01-12', '2027-01-13'] },
        scope: { type: 'whole' },
        source: 'https://www.kaiyukan.com/info/hours/',
        quote: '次回の休館日 2027年1月12日(火)・13日(水)',
        checkedOn,
      },
    ],
    access: {
      rail: ['subway'],
      source: 'https://www.kaiyukan.com/info/access/',
      quote: '大阪メトロ 中央線 「大阪港駅（海遊館前）」1番出口より徒歩約5分',
      checkedOn,
    },
  },
  {
    slug: 'umeda-sky-building',
    city: 'osaka',
    pin: { status: 'pinned', placeId: 'ChIJbbXqmojmAGARh-OQXHzkwEc', pinnedOn: checkedOn },
    name: { en: 'Umeda Sky Building', zh: '梅田蓝天大厦', ja: '梅田スカイビル' },
    aliases: ['Kuchu Teien Observatory', 'Floating Garden Observatory', 'Umeda Sky', '空中庭园展望台', '空中庭園展望台', '梅田天空大厦'],
    visitMinutes: 60,
    hours: {
      type: 'schedule',
      // The observatory's hours: a stop at the building is a visit to it. The page also lists single days with shorter hours (2027-04-18 closes 18:00), which are not recorded.
      periods: [{ from: '01-01', to: '12-31', open: '09:30', close: '22:30' }],
      source: 'https://www.skybldg.co.jp/observatory/information/',
      quote: '9:30〜22:30(最終入場22:00)',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['jr', 'private_rail', 'subway'],
      source: 'https://www.skybldg.co.jp/access/',
      quote: 'JR大阪駅から徒歩7分 / 阪急大阪梅田駅から徒歩9分 / Osaka Metro 梅田駅から徒歩9分',
      checkedOn,
    },
  },
  {
    slug: 'tsutenkaku',
    city: 'osaka',
    pin: { status: 'pinned', placeId: 'ChIJ_0Lgd2DnAGARV0X03lbPy-U', pinnedOn: checkedOn },
    name: { en: 'Tsutenkaku', zh: '通天阁', ja: '通天閣' },
    aliases: ['Tsutenkaku Tower', 'Tsūtenkaku'],
    visitMinutes: 60,
    hours: {
      type: 'schedule',
      // The general observation deck. The three single days are the ones announced for 2026–27 and move every year.
      periods: [
        { from: '01-01', to: '01-01', open: '10:00', close: '20:00' },
        { from: '01-02', to: '12-24', open: '09:00', close: '21:45' },
        { from: '12-25', to: '12-25', open: '09:30', close: '21:45' },
        { from: '12-26', to: '12-30', open: '09:00', close: '21:45' },
        { from: '12-31', to: '12-31', open: '09:00', close: '19:00' },
      ],
      source: 'https://www.tsutenkaku.co.jp/annai/index.html',
      quote: '一般展望台 9:00～21:45 (最終入場21:15) / [ 2026年12月25日（金）] 一般展望台 9:30～21:45 / [ 2026年12月31日（木）] 一般展望台 9:00～19:00 / [ 2027年1月1日（金）] 一般展望台 10:00～20:00',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['subway', 'jr', 'private_rail'],
      source: 'https://www.tsutenkaku.co.jp/access/index.html',
      quote: 'Osaka Metro 堺筋線 恵美須町駅 3番出口【徒歩3分】 / JR 環状線 新今宮駅 通天閣口出口(東出口)【徒歩6分】 / 南海電車 南海本線 新今宮駅 西出口【徒歩10分】',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

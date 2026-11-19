import type { PlaceRecordInput } from '../record.js';

// Every fact was read on the official page named in `source` on 2026-11-19; `quote` is copied from that page.
// Place IDs come from `bun run places:pin` and were confirmed by name; only the ID is stored, as Google's terms require.
// `visitMinutes` is our own planning estimate, not a sourced fact. Names and aliases are editorial.
const checkedOn = '2026-11-19';

export const kyoto = [
  {
    slug: 'higashi-hongan-ji',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJkWH_sqUIAWARWsn28jWc7y0', pinnedOn: checkedOn },
    name: { en: 'Higashi Hongan-ji', zh: '东本愿寺', ja: '東本願寺' },
    aliases: ['Higashi Honganji', 'Higashi Hongwanji', '真宗本庙', '真宗本廟'],
    visitMinutes: 45,
    hours: {
      type: 'schedule',
      periods: [
        { from: '03-01', to: '10-31', open: '05:50', close: '17:30' },
        { from: '11-01', to: '02-28', open: '06:20', close: '16:30' },
      ],
      source: 'https://www.higashihonganji.or.jp/worship/access/',
      quote: '3月～10月 5:50～17:30 11月～2月 6:20～16:30',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['jr', 'subway'],
      source: 'https://www.higashihonganji.or.jp/worship/access/',
      quote: 'JR京都駅より徒歩7分 / 地下鉄・五条駅より徒歩5分',
      checkedOn,
    },
  },
  {
    slug: 'kiyomizu-dera',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJB_vchdMIAWARujTEUIZlr2I', pinnedOn: checkedOn },
    name: { en: 'Kiyomizu-dera', zh: '清水寺', ja: '清水寺' },
    aliases: ['Kiyomizudera', 'Kiyomizu Temple'],
    visitMinutes: 90,
    hours: {
      type: 'schedule',
      // The temple publishes one year at a time; the night-viewing dates below are the 2026 ones and move every year.
      periods: [
        { from: '01-01', to: '03-26', open: '06:00', close: '18:00' },
        { from: '03-27', to: '04-05', open: '06:00', close: '21:30' },
        { from: '04-06', to: '06-30', open: '06:00', close: '18:00' },
        { from: '07-01', to: '08-13', open: '06:00', close: '18:30' },
        { from: '08-14', to: '08-16', open: '06:00', close: '21:30' },
        { from: '08-17', to: '08-31', open: '06:00', close: '18:30' },
        { from: '09-01', to: '11-20', open: '06:00', close: '18:00' },
        { from: '11-21', to: '11-30', open: '06:00', close: '21:30' },
        { from: '12-01', to: '12-31', open: '06:00', close: '18:00' },
      ],
      source: 'https://www.kiyomizudera.or.jp/access.php',
      quote: '12.1 〜 12.31 6:00 18:00 / 11.21 〜 11.30 （秋の夜間特別拝観） 6:00 21:30 (21:00受付終了)',
      checkedOn,
    },
    closures: [],
    access: {
      // The only station the temple gives on foot (about 25 minutes); JR and Hankyu are bus transfers.
      rail: ['private_rail'],
      source: 'https://www.kiyomizudera.or.jp/access.php',
      quote: '京阪電鉄 清水五条駅から 約徒歩25分',
      checkedOn,
    },
  },
  {
    slug: 'fushimi-inari-taisha',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJIW0uPRUPAWAR6eI6dRzKGns', pinnedOn: checkedOn },
    name: { en: 'Fushimi Inari Taisha', zh: '伏见稻荷大社', ja: '伏見稲荷大社' },
    aliases: ['Fushimi Inari', '伏见稻荷', '伏見稲荷', '千本鸟居', 'Senbon Torii'],
    visitMinutes: 120,
    // The shrine's own site states no opening hours for the grounds.
    hours: { type: 'not_recorded' },
    closures: [],
    access: {
      rail: ['jr', 'private_rail'],
      source: 'https://inari.jp/access/',
      quote: '･JR奈良線 稲荷駅下車 徒歩直ぐ (京都駅より5分) / ･京阪本線 伏見稲荷駅下車 東へ徒歩5分',
      checkedOn,
    },
  },
  {
    slug: 'tofuku-ji',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJrZ8NkJJIAWARwRVgbKoRx2I', pinnedOn: checkedOn },
    name: { en: 'Tofuku-ji', zh: '东福寺', ja: '東福寺' },
    aliases: ['Tofukuji', '通天桥', '通天橋', 'Tsutenkyo'],
    visitMinutes: 60,
    hours: {
      type: 'schedule',
      // `close` is when the gates shut; admission to the ticketed areas ends 30 minutes earlier. The autumn dates are the 2026 ones.
      periods: [
        { from: '04-01', to: '11-13', open: '09:00', close: '16:30' },
        { from: '11-14', to: '12-06', open: '08:30', close: '16:30' },
        { from: '12-07', to: '03-31', open: '09:00', close: '16:00' },
      ],
      source: 'https://tofukuji.jp/guide/',
      quote: '11月14日～12月6日まで 通天橋：8:30～16:00 方丈庭園：9:00～16:00 16:00 16:30 / 12月 7日～3月31日まで 9:00～15:30 15:30 16:00 / 4月1日～10月31日まで 9:00～16:00 16:00 16:30',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['jr', 'private_rail'],
      source: 'https://tofukuji.jp/access/',
      quote: '各線／京都 JR奈良線約3分 JR／東福寺 徒歩約10分 東福寺 / 京阪／東福寺 徒歩約10分 東福寺',
      checkedOn,
    },
  },
  {
    slug: 'nishiki-market',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJT8uMzZwIAWARnGzsARCjnrY', pinnedOn: checkedOn },
    name: { en: 'Nishiki Market', zh: '锦市场', ja: '錦市場' },
    aliases: ['Nishiki Ichiba', 'Nishiki Food Market', '京都锦市场'],
    visitMinutes: 90,
    // The association publishes no market-wide hours; each shop sets its own.
    hours: { type: 'not_recorded' },
    closures: [
      {
        when: { type: 'weekly', days: [3], holidayShift: false },
        scope: { type: 'most_shops' },
        source: 'https://www.kyoto-nishiki.or.jp/contact/',
        // The page says "many shops", not "most".
        quote: '（水曜日にお休みされるお店が多いです）',
        checkedOn,
      },
      {
        when: { type: 'dates', dates: ['2027-01-01', '2027-01-02', '2027-01-03'] },
        scope: { type: 'most_shops' },
        source: 'https://www.kyoto-nishiki.or.jp/contact/',
        quote: '1月1日から3日は、閉まっている店舗が多いです。各店舗に直接お問い合わせください。',
        checkedOn,
      },
    ],
    access: {
      rail: ['subway', 'private_rail'],
      source: 'https://www.kyoto-nishiki.or.jp/access/',
      quote: '地下鉄烏丸線「四条」駅下車徒歩 約3分 / 阪急京都線「烏丸」駅下車徒歩 約3分',
      checkedOn,
    },
  },
  {
    slug: 'kyoto-national-museum',
    city: 'kyoto',
    pin: { status: 'pinned', placeId: 'ChIJt1kBRcoIAWAR00msugECEYw', pinnedOn: checkedOn },
    name: { en: 'Kyoto National Museum', zh: '京都国立博物馆', ja: '京都国立博物館' },
    aliases: ['Kyohaku', '京博'],
    visitMinutes: 90,
    // Hours differ by exhibition period and run late on Fridays, which this format cannot express yet.
    hours: { type: 'not_recorded' },
    closures: [
      {
        when: { type: 'weekly', days: [1], holidayShift: true },
        scope: { type: 'whole' },
        source: 'https://www.kyohaku.go.jp/jp/visit/info/',
        quote: '※ただし、月曜日が祝日・休日となる場合は開館し、翌火曜日を休館とします。',
        checkedOn,
      },
      {
        when: { type: 'dates', dates: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'] },
        scope: { type: 'whole' },
        source: 'https://www.kyohaku.go.jp/jp/visit/info/',
        quote: '2026年12月28日（月）～2027年1月1日（金・祝）',
        checkedOn,
      },
      ...([['2026-12-01', '2026-12-20'], ['2027-03-24', '2027-04-18']] as const).map(([from, until]) => ({
        when: { type: 'range' as const, from, until },
        scope: { type: 'part' as const, name: { en: 'exhibition galleries', zh: '展厅', ja: '展示室' }, aliases: ['galleries', 'exhibition', '展览', '馆内'] },
        source: 'https://www.kyohaku.go.jp/jp/visit/info/',
        quote: '2026年12月1日（火）～12月20日（日） 2027年3月24日（水）～4月18日（日） … 屋外展示のみご覧いただけます。展示室はご覧いただけません。',
        checkedOn,
      })),
    ],
    access: {
      // JR Kyoto Station is a 20-minute walk by the museum's own figure.
      rail: ['private_rail', 'jr'],
      source: 'https://www.kyohaku.go.jp/jp/visit/access/',
      quote: '七条駅下車、東へ徒歩7分 / JR京都駅下車、七条通を東へ徒歩20分',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

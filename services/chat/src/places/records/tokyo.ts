import type { PlaceRecordInput } from '../record.js';

// See kyoto.ts for how these records are sourced.
const checkedOn = '2026-11-19';

export const tokyo = [
  {
    slug: 'tsukiji-outer-market',
    city: 'tokyo',
    pin: { status: 'pinned', placeId: 'ChIJW2cLzSGLGGARXAKXv6EkbqI', pinnedOn: checkedOn },
    name: { en: 'Tsukiji Outer Market', zh: '筑地场外市场', ja: '築地場外市場' },
    aliases: ['Tsukiji Market', 'Tsukiji Fish Market', '筑地市场', '筑地外市场'],
    visitMinutes: 90,
    // Normal sales run 09:00–14:00, after which each shop decides; there is no closing time to check against.
    hours: { type: 'not_recorded' },
    closures: [
      {
        // The wholesale market's closed days, published per month; they are not a weekly rule. Extend this list as months are published.
        when: {
          type: 'dates',
          dates: [
            '2026-12-02', '2026-12-06', '2026-12-09', '2026-12-13', '2026-12-16', '2026-12-20', '2026-12-23', '2026-12-31',
            '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-10', '2027-01-11', '2027-01-13', '2027-01-17',
            '2027-01-20', '2027-01-24', '2027-01-27', '2027-01-31',
          ],
        },
        scope: { type: 'most_shops' },
        source: 'https://www.tsukiji.or.jp/calendar/',
        quote: '※東京都中央卸売市場の休業日カレンダーです。場外市場でも閉まっている店があります。各店の営業日については直接店舗にご確認下さい。',
        checkedOn,
      },
    ],
    access: {
      rail: ['subway'],
      source: 'https://www.tsukiji.or.jp/access/',
      quote: '・都営大江戸線「築地市場駅」A1出口より徒歩1分 / ・東京メトロ日比谷線「築地駅」1番、2番出口より徒歩1分',
      checkedOn,
    },
  },
  {
    slug: 'senso-ji',
    city: 'tokyo',
    pin: { status: 'pinned', placeId: 'ChIJ8T1GpMGOGGARDYGSgpooDWw', pinnedOn: checkedOn },
    name: { en: 'Senso-ji', zh: '浅草寺', ja: '浅草寺' },
    aliases: ['Sensoji', 'Asakusa Kannon', '浅草观音寺'],
    visitMinutes: 45,
    // Only the main hall has published hours (to 17:00); the grounds have none, so an evening visit is not checked.
    hours: { type: 'not_recorded' },
    closures: [],
    access: {
      rail: ['private_rail', 'subway'],
      source: 'https://www.senso-ji.jp/access/',
      quote: '東武スカイツリーライン：浅草駅より徒歩5分 / 東京メトロ銀座線：浅草駅より徒歩5分 / 都営地下鉄浅草線：浅草駅A4出口より徒歩5分',
      checkedOn,
    },
  },
  {
    slug: 'tokyo-national-museum',
    city: 'tokyo',
    pin: { status: 'pinned', placeId: 'ChIJEX3XFIOOGGAR3XdJvRjWLyM', pinnedOn: checkedOn },
    name: { en: 'Tokyo National Museum', zh: '东京国立博物馆', ja: '東京国立博物館' },
    aliases: ['Tohaku', '东博', '東博'],
    visitMinutes: 120,
    // 09:30–17:00, but until 20:00 on Fridays and Saturdays, which this format cannot express yet.
    hours: { type: 'not_recorded' },
    closures: [
      {
        // The museum lists a few Mondays it opens anyway (next: 2027-03-29); this rule would wrongly flag those.
        when: { type: 'weekly', days: [1], holidayShift: true },
        scope: { type: 'whole' },
        source: 'https://www.tnm.jp/modules/r_free_page/index.php?id=113',
        quote: '月曜日（ただし月曜日が祝日または休日の場合は開館し、翌平日に休館）',
        checkedOn,
      },
      {
        when: { type: 'dates', dates: ['2026-12-15', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31'] },
        scope: { type: 'whole' },
        source: 'https://www.tnm.jp/modules/r_free_page/index.php?id=113',
        quote: '2026年12月15日（火）は、設備保守点検のため休館いたします。 / （年末休館は2026年12月26日（土）～2026年12月31日（木）まで。',
        checkedOn,
      },
      {
        when: { type: 'range', from: '2026-12-22', until: '2026-12-25' },
        scope: { type: 'part', name: { en: 'main galleries (Honkan, Heiseikan, Toyokan)', zh: '本馆、平成馆和东洋馆', ja: '本館・平成館・東洋館' }, aliases: ['Honkan', 'Heiseikan', 'Toyokan', '本馆', '平成馆', '东洋馆'] },
        source: 'https://www.tnm.jp/modules/r_free_page/index.php?id=113',
        quote: 'ただし、2026年12月22日（火）～12月25日（金）は、法隆寺宝物館・黒田記念館のみ開館いたします。',
        checkedOn,
      },
    ],
    access: {
      // The subway and Keisei stations are a 15-minute walk by the museum's own figure.
      rail: ['jr', 'subway', 'private_rail'],
      source: 'https://www.tnm.jp/modules/r_free_page/index.php?id=113',
      quote: 'JR上野駅公園口、または鶯谷駅南口下車 徒歩10分 / 東京メトロ 銀座線・日比谷線上野駅、千代田線根津駅下車 徒歩15分 / 京成電鉄 京成上野駅下車 徒歩15分',
      checkedOn,
    },
  },
  {
    slug: 'meiji-jingu',
    city: 'tokyo',
    pin: { status: 'pinned', placeId: 'ChIJ5SZMmreMGGARcz8QSTiJyo8', pinnedOn: checkedOn },
    name: { en: 'Meiji Jingu', zh: '明治神宫', ja: '明治神宮' },
    aliases: ['Meiji Shrine', 'Meiji-jingu', 'Meiji Jingu Shrine'],
    visitMinutes: 60,
    hours: {
      type: 'schedule',
      // The gates follow sunrise and sunset, so the shrine publishes one pair of times per month.
      periods: [
        { from: '01-01', to: '01-31', open: '06:40', close: '16:20' },
        { from: '02-01', to: '02-28', open: '06:20', close: '16:50' },
        { from: '03-01', to: '03-31', open: '05:40', close: '17:20' },
        { from: '04-01', to: '04-30', open: '05:10', close: '17:50' },
        { from: '05-01', to: '05-31', open: '05:00', close: '18:10' },
        { from: '06-01', to: '06-30', open: '05:00', close: '18:30' },
        { from: '07-01', to: '07-31', open: '05:00', close: '18:20' },
        { from: '08-01', to: '08-31', open: '05:00', close: '18:00' },
        { from: '09-01', to: '09-30', open: '05:20', close: '17:20' },
        { from: '10-01', to: '10-31', open: '05:40', close: '16:40' },
        { from: '11-01', to: '11-30', open: '06:10', close: '16:10' },
        { from: '12-01', to: '12-31', open: '06:40', close: '16:00' },
      ],
      source: 'https://www.meijijingu.or.jp/sanpai/2.php',
      quote: '明治神宮は日の出と共に開門し、日の入りに合わせて閉門します。 / 11月 6時10分 16時10分 / 12月 6時40分 16時00分 / 1月 6時40分 16時20分',
      checkedOn,
    },
    closures: [],
    access: {
      rail: ['jr', 'subway', 'private_rail'],
      source: 'https://www.meijijingu.or.jp/access/',
      quote: 'JR山手線「原宿」駅 / 東京メトロ千代田線・副都心線「明治神宮前＜原宿＞」駅 / 小田急線「参宮橋」駅',
      checkedOn,
    },
  },
] satisfies PlaceRecordInput[];

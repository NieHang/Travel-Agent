import { legDetails } from './travel-leg.js';

const draft = (line: string) => `Overview\nBefore you go\n- Compare a JR Pass with the plan; Narita Express seats sell out\n**Day 1 | Ueno**\n- ${line}\n- Tonight: Sotetsu Fresa Inn (5 min walk from JR Ueno Station)`;

it.each([
  '14:00 Narita Airport → Ueno by train',
  '17:00 Senso-ji and Nakamise (by subway): lit up in the evening, fewer people than by day',
  '09:30 Tokyo National Museum (walk from the hotel): quieter right after opening, approx. 2 h',
  '11:30 Kyoto Station → Kansai Airport by train; leave plenty of time for check-in',
  '约 11:00 难波 → 关西机场（电车），预留约 2.5 小时办理登机与安检',
  '约 11:00 退房，难波一带 → 关西机场乘电车；国际航班建议提前约 3 小时到机场，请按航班时间再核对',
  '09:30 Kiyomizu-dera, approx. 1.5 h at an easy pace; the approach is uphill, so use the taxi drop-off',
  '15:00 Osaka Castle by subway (approx. 1.5 h)',
  '08:45 Tenryu-ji garden, approx. 1 h — garden viewing is mostly from the veranda, little walking',
  '10:00 Fushimi Inari (by train): walk the torii path partway, approx. 1.5 h',
  '约 16:00 梅田阪急百货（地铁）：地下美食街',
  '10:00 Nara Park (train to Kintetsu-Nara Station): deer and a slow walk',
  '## 第3天 | 东京 → 大阪 · 新干线移动（标准）',
  '约 09:00 明治神宫（步行）：清晨最安静，游览路线约 1.5 小时',
  '08:30 从住处出发，乘火车前往奈良（具体线路与换乘请查时刻表）',
])('lets a mode-only leg through: %s', (line) => {
  expect(legDetails(draft(line))).toEqual([]);
});

it.each([
  '14:00 Arrive Haneda → Keikyu Line to Shimbashi',
  '07:30 Shimbashi → Shinkansen Nozomi to Kyoto',
  '17:00 Train back to Osaka (Keihan to Kyobashi then JR)',
  '08:30 Tsukiji Outer Market (walk approx. 20 min or taxi approx. 10 min)',
  '12:30 Lunch near Kyoto Station, then bus or taxi to Kiyomizu-dera, approx. 20 min',
  '10:00 Kyoto → Nara by train, approx. 1 h',
  '07:30 Shinkansen to Kyoto, approx. 2.5 h',
  '10:15 Fushimi Inari (train, 1 stop): torii path',
  '14:00 Osaka Castle (subway, 1 transfer)',
  '约 09:00 明治神宫（JR 山手线新宿 → 原宿）',
  '约 14:30 涩谷十字路口（地铁 1 站）',
  '约 08:30 浅草寺（地铁，1 次换乘）',
  '07:30 伏见稻荷大社（从京都站乘 JR 前往）：清晨人最少，约 2 小时',
  '09:00 Taxi to Arashiyama (avoids the crowded train), approx. 30 min',
  '约 16:00 梅田（步行约 10 分钟）',
  '约 11:00 难波 → 关西机场（南海 rapi:t）',
  '若从伊丹机场走，京都站 → 机场巴士约 55 分钟（请按实际航班确认）',
  'Alternatives: if tired, take the bus back from Kasuga Taisha (approx. 10 min)',
])('flags a leg with a line, operator, stop, transfer or travel time: %s', (line) => {
  expect(legDetails(draft(line))).toEqual([line]);
});

import type { FormFieldName, TripType } from '@autix/contracts';
import { z } from 'zod';

const en = {
  japanDestinationTitle: 'Choose a destination in Japan',
  japanCities: ['Tokyo', 'Kyoto', 'Osaka', 'Nara'],
  preferenceTags: ['Food', 'Onsen', 'Nature', 'Shopping', 'History', 'Slow pace'],
  outsideJapan: (places: string[], japan: string | null): string =>
    `Hilda only plans trips within Japan, so I can't plan ${places.join(', ')}.` +
    (japan ? ` I can plan just ${japan}, or you can choose another destination in Japan.` : ' Please choose a destination in Japan.'),
  tripTypes: {
    business: { label: 'Business travel', description: 'Combine work with short visits' },
    family: { label: 'Family travel', description: 'A pace suitable for families' },
    solo: { label: 'Solo travel', description: 'Travel around your interests' },
    couple: { label: 'Couple travel', description: 'Travel together as a couple' },
    friends: { label: 'Friends trip', description: 'Travel together with friends' },
  } satisfies Record<TripType, { label: string; description: string }>,
  tripTypeTitle: 'What kind of trip is this?',
  chooseType: 'Please choose a trip type.',
  requirementsTitle: 'Travel requirements',
  collect: 'Please provide the missing travel requirements.',
  generateDraft: 'Generate itinerary draft',
  fields: {
    destination: { label: 'Destination', placeholder: 'For example, Tokyo, Japan' },
    dates: { label: 'Travel dates', placeholder: null },
    travelers: { label: 'Travelers', placeholder: null },
    preferences: { label: 'Interests and special requirements', placeholder: 'For example, food, nature, accessibility' },
  } satisfies Record<FormFieldName, { label: string; placeholder: string | null }>,
  review: 'Review the itinerary draft, then confirm or edit the requirements.',
  confirmed: 'Your itinerary has been confirmed and saved.',
  confirm: 'Confirm itinerary',
  edit: 'Edit requirements',
  resume: 'Return to itinerary planning',
  separator: ': ',
  draftReady: (overview: string | null): string =>
    `${overview ? `${overview}\n\n` : ''}The full itinerary is in the trip panel.`,
  nights: (from: number, to: number): string => (from === to ? `night ${from + 1}` : `nights ${from + 1}–${to + 1}`),
  chooseStay: (hotel: string, nights: string): string => `Stay at ${hotel} for ${nights}`,
  stayChosen: (hotel: string, nights: string): string => `Updated ${nights}: ${hotel}.`,
  lookupHotels: (place: string): string => `Hotels in ${place}`,
};
export type Copy = typeof en;

const zh: Copy = {
  japanDestinationTitle: '选择日本的目的地',
  japanCities: ['东京', '京都', '大阪', '奈良'],
  preferenceTags: ['美食', '温泉', '自然风光', '购物', '历史文化', '慢节奏'],
  outsideJapan: (places: string[], japan: string | null): string =>
    `Hilda 目前只规划日本境内的旅行，暂时无法安排${places.join('、')}。` +
    (japan ? `可以只规划${japan}，或换一个日本的目的地。` : '请换一个日本的目的地。'),
  tripTypes: {
    business: { label: '商务出差', description: '兼顾工作安排与短途游览' },
    family: { label: '亲子游', description: '适合家庭出行的节奏' },
    solo: { label: '个人游', description: '按个人兴趣安排行程' },
    couple: { label: '情侣游', description: '适合两人出行' },
    friends: { label: '朋友结伴', description: '适合朋友一起出行' },
  },
  tripTypeTitle: '这次是什么类型的出行？',
  chooseType: '请选择旅游类型。',
  requirementsTitle: '旅游需求',
  collect: '请补充尚未提供的旅游需求。',
  generateDraft: '生成路线草案',
  fields: {
    destination: { label: '目的地', placeholder: '例如日本东京' },
    dates: { label: '出行日期', placeholder: null },
    travelers: { label: '出行人数', placeholder: null },
    preferences: { label: '兴趣与特殊需求', placeholder: '例如美食、自然风景、无障碍设施' },
  },
  review: '请查看路线草案，可确认或修改需求。',
  confirmed: '已确认并保存旅游路线。',
  confirm: '确认路线',
  edit: '修改需求',
  resume: '返回路线规划',
  separator: '：',
  draftReady: (overview: string | null): string => `${overview ? `${overview}\n\n` : ''}完整行程在行程面板中。`,
  nights: (from: number, to: number): string => (from === to ? `第 ${from + 1} 晚` : `第 ${from + 1}–${to + 1} 晚`),
  chooseStay: (hotel: string, nights: string): string => `${nights}住${hotel}`,
  stayChosen: (hotel: string, nights: string): string => `已将${nights}改为${hotel}。`,
  lookupHotels: (place: string): string => `${place}酒店`,
};

export function copy(locale: string): Copy {
  return locale.toLowerCase().startsWith('zh') ? zh : en;
}

const LookupArgsSchema = z.object({
  place: z.string().optional(),
  city: z.string().optional(),
  query: z.string().optional(),
  checkInParam: z.object({
    checkInDate: z.string().date(),
    stayNights: z.number().int().positive(),
  }).optional(),
});

export function lookupSubject(tool: string, args: Record<string, unknown>, locale: string): string | null {
  const parsed = LookupArgsSchema.safeParse(args);
  if (!parsed.success) return null;
  const { place, city, query, checkInParam } = parsed.data;
  const location = place?.trim() || city?.trim();
  const subject = location && tool.endsWith('searchHotels') ? copy(locale).lookupHotels(location) : location || query?.trim();
  if (!subject) return null;
  if (!checkInParam) return subject;
  const end = new Date(checkInParam.checkInDate);
  end.setUTCDate(end.getUTCDate() + checkInParam.stayNights);
  return `${subject} · ${checkInParam.checkInDate.slice(5).replace('-', '/')}–${end.toISOString().slice(5, 10).replace('-', '/')}`;
}

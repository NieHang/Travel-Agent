import type { TripType } from '@autix/contracts';

const en = {
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
    departureDate: { label: 'Departure date', placeholder: null },
    returnDate: { label: 'Return date', placeholder: null },
    travelers: { label: 'Travelers', placeholder: null },
    preferences: { label: 'Interests and special requirements', placeholder: 'For example, food, nature, accessibility' },
  },
  review: 'Review the itinerary draft, then confirm or edit the requirements.',
  confirmed: 'Your itinerary has been confirmed and saved.',
  confirm: 'Confirm itinerary',
  edit: 'Edit requirements',
  resume: 'Return to itinerary planning',
  separator: ': ',
};
export type Copy = typeof en;

const zh: Copy = {
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
    departureDate: { label: '出发日期', placeholder: null },
    returnDate: { label: '返程日期', placeholder: null },
    travelers: { label: '出行人数', placeholder: null },
    preferences: { label: '兴趣与特殊需求', placeholder: '例如美食、自然风景、无障碍设施' },
  },
  review: '请查看路线草案，可确认或修改需求。',
  confirmed: '已确认并保存旅游路线。',
  confirm: '确认路线',
  edit: '修改需求',
  resume: '返回路线规划',
  separator: '：',
};

export function copy(locale: string): Copy {
  return locale.toLowerCase().startsWith('zh') ? zh : en;
}

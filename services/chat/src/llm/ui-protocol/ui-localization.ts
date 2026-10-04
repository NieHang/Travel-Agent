const en = {
  tripLabels: [
    'Business travel',
    'Family travel',
    'Solo travel',
    'Couple travel',
  ],
  tripDescriptions: [
    'Combine work with short visits',
    'A pace suitable for families',
    'Travel around your interests',
    'Travel together as a couple',
  ],
  destination: 'Destination',
  destinationPlaceholder: 'For example, Tokyo, Japan',
  departureDate: 'Departure date',
  returnDate: 'Return date',
  travelers: 'Travelers',
  budget: 'Total budget',
  preferences: 'Interests and special requirements',
  preferencesPlaceholder: 'For example, food, nature, accessibility',
  progress: 'Itinerary planning progress',
  stages: ['Trip type', 'Requirements', 'Itinerary preview', 'Confirmation'],
  chooseType: 'Please choose a trip type.',
  tripTypeTitle: 'What kind of trip is this?',
  collect: 'Please provide the missing travel requirements.',
  requirementsTitle: 'Travel requirements',
  generateDraft: 'Generate itinerary draft',
  awaiting:
    'Please confirm the draft below. Confirmation saves the itinerary and does not make bookings.',
  confirmationTitle: 'Confirm itinerary',
  confirm: 'Confirm itinerary',
  cancel: 'Back to editing',
  confirmed: 'Your itinerary has been confirmed and saved.',
  review: 'Review the itinerary draft, then confirm or edit the requirements.',
  confirmedTitle: 'Confirmed itinerary',
  draftTitle: 'Itinerary draft',
  edit: 'Edit requirements',
  resume: 'Return to itinerary planning',
  refine: 'Add filters. Your original query conditions will be preserved.',
  queryTitle: 'Search filters',
  filters: 'Additional conditions',
  filtersPlaceholder: 'For example, budget, amenities, or check-in dates',
  updateQuery: 'Update search',
  noDraft: 'There is no itinerary draft to confirm yet.',
  noConfirmation: 'There is no pending confirmation.',
  noPlanning: 'There is no planning session to resume.',
};
export type UICopy = typeof en;
const zh: UICopy = {
  tripLabels: ['商务出差', '亲子游', '个人游', '情侣游'],
  tripDescriptions: [
    '兼顾工作安排与短途游览',
    '适合家庭出行的节奏',
    '按个人兴趣安排行程',
    '适合两人出行',
  ],
  destination: '目的地',
  destinationPlaceholder: '例如日本东京',
  departureDate: '出发日期',
  returnDate: '返程日期',
  travelers: '出行人数',
  budget: '总预算',
  preferences: '兴趣与特殊需求',
  preferencesPlaceholder: '例如美食、自然风景、无障碍设施',
  progress: '路线规划进度',
  stages: ['旅游类型', '旅游需求', '路线预览', '路线确认'],
  chooseType: '请选择旅游类型。',
  tripTypeTitle: '这次是什么类型的出行？',
  collect: '请补充尚未提供的旅游需求。',
  requirementsTitle: '旅游需求',
  generateDraft: '生成路线草案',
  awaiting: '请确认下面的路线草案。确认只保存路线，不会预订。',
  confirmationTitle: '确认旅游路线',
  confirm: '确认路线',
  cancel: '返回修改',
  confirmed: '已确认并保存旅游路线。',
  review: '请查看路线草案，可确认或修改需求。',
  confirmedTitle: '已确认的路线',
  draftTitle: '路线草案',
  edit: '修改需求',
  resume: '返回路线规划',
  refine: '补充筛选条件，原有查询条件将保留。',
  queryTitle: '查询筛选',
  filters: '补充条件',
  filtersPlaceholder: '例如预算、设施或入住日期',
  updateQuery: '更新查询',
  noDraft: '当前还没有可确认的路线草案。',
  noConfirmation: '当前没有待处理的路线确认。',
  noPlanning: '当前没有可恢复的路线规划。',
};
const dictionaries: Record<string, UICopy> = { zh, en };
export function normalizeLocale(value: string): string {
  const locale = Intl.getCanonicalLocales(value)[0];
  if (!locale) throw new Error('Invalid language tag');
  return locale;
}
export function resolveReplyLanguage(
  preferredLocale?: string,
  detectedLanguage?: string,
  previousLanguage?: string,
): string {
  return normalizeLocale(
    preferredLocale ?? detectedLanguage ?? previousLanguage ?? 'en',
  );
}
export function getUICopy(language = 'en'): UICopy {
  const locale = normalizeLocale(language);
  return (
    dictionaries[locale] ?? dictionaries[new Intl.Locale(locale).language] ?? en
  );
}

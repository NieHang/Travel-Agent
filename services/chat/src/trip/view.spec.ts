import type { Component, ResultGroup } from '@autix/contracts';
import { initialState, type TripState } from './state.js';
import { copy } from './copy.js';
import { reduce } from './commands.js';
import { describe as describeCommand, render, stageMessage } from './view.js';

const zh = copy('zh');
const en = copy('en');
const at = (patch: Partial<TripState>): TripState => ({ ...initialState(1), ...patch });
const hotels: ResultGroup = {
  panel: 'hotels',
  items: [{ ref: 'h1', id: null, title: { original: 'Hotel', translation: null }, address: null, price: null, rating: null, url: null, image: null, details: [], amenities: [], summary: null }],
};
const types = (components: Component[]) => components.map((c) => c.type);

describe('render', () => {
  it.each([
    ['en', 'Lisbon', null, 'Choose a destination in Japan', ['Tokyo', 'Kyoto', 'Osaka', 'Nara'], "Hilda only plans trips within Japan, so I can't plan Lisbon. Please choose a destination in Japan."],
    ['zh', '成都', null, '选择日本的目的地', ['东京', '京都', '大阪', '奈良'], 'Hilda 目前只规划日本境内的旅行，暂时无法安排成都。请换一个日本的目的地。'],
    ['en', 'Seoul', 'Fukuoka', 'Choose a destination in Japan', ['Fukuoka', 'Tokyo', 'Kyoto', 'Osaka', 'Nara'], "Hilda only plans trips within Japan, so I can't plan Seoul. I can plan just Fukuoka, or you can choose another destination in Japan."],
    ['zh', '首尔', '福冈', '选择日本的目的地', ['福冈', '东京', '京都', '大阪', '奈良'], 'Hilda 目前只规划日本境内的旅行，暂时无法安排首尔。可以只规划福冈，或换一个日本的目的地。'],
    ['en', 'Seoul', 'Kyoto', 'Choose a destination in Japan', ['Kyoto', 'Tokyo', 'Osaka', 'Nara'], "Hilda only plans trips within Japan, so I can't plan Seoul. I can plan just Kyoto, or you can choose another destination in Japan."],
  ] as const)('renders %s refusal for %s with Japan part %s', (locale, outside, japan, title, cities, message) => {
    const state = at({ stage: 'requirements', outsideJapan: { places: [outside], japan }, clarify: { field: 'other', question: 'ignored', options: [] } });
    const components = render(state, copy(locale));
    expect(types(components)).toEqual(['choice', 'form']);
    const choice = components[0];
    expect(choice).toMatchObject({ type: 'choice', command: 'set_destination', title });
    if (choice.type !== 'choice') throw new Error('Expected destination choice');
    expect(choice.options.map((option) => option.value)).toEqual(cities);
    expect(choice.options.map((option) => option.label)).toEqual(cities);
    expect(choice.options.every((option) => option.description === null)).toBe(true);
    expect(stageMessage(state, copy(locale))).toBe(message);
  });

  it('joins multiple refused places in both languages', () => {
    const state = at({ outsideJapan: { places: ['Paris', 'Seoul'], japan: null } });
    expect(stageMessage(state, en)).toBe("Hilda only plans trips within Japan, so I can't plan Paris, Seoul. Please choose a destination in Japan.");
    expect(stageMessage(state, zh)).toBe('Hilda 目前只规划日本境内的旅行，暂时无法安排Paris、Seoul。请换一个日本的目的地。');
  });
  it('idle renders nothing', () => expect(render(at({}), zh)).toEqual([]));

  it('trip_type renders every trip type in both languages', () => {
    const [choice] = render(at({ stage: 'trip_type' }), zh);
    expect(choice).toMatchObject({ type: 'choice', command: 'set_trip_type' });
    expect(choice.type === 'choice' && choice.options.map((o) => o.value)).toEqual(['business', 'family', 'solo', 'couple', 'friends']);
    expect(choice.type === 'choice' && choice.options[1].label).toBe('亲子游');
    const [enChoice] = render(at({ stage: 'trip_type' }), en);
    expect(enChoice.type === 'choice' && enChoice.options[1].label).toBe('Family travel');
  });

  it('renders all four empty fields with suggestions and a display-only traveler default', () => {
    const state = at({ stage: 'requirements' });
    expect(render(state, en)).toEqual([{
      type: 'form', command: 'submit_requirements', title: 'Travel requirements', submitLabel: 'Generate itinerary draft',
      fields: [
        { name: 'destination', label: 'Destination', placeholder: 'For example, Tokyo, Japan', value: null, suggestions: ['Tokyo', 'Kyoto', 'Osaka', 'Nara'] },
        { name: 'dates', label: 'Travel dates', value: null },
        { name: 'travelers', label: 'Travelers', value: 2 },
        { name: 'preferences', label: 'Interests and special requirements', placeholder: 'For example, food, nature, accessibility', value: '', suggestions: ['Food', 'Onsen', 'Nature', 'Shopping', 'History', 'Slow pace'] },
      ],
    }]);
    expect(state.requirements).toEqual({});
  });

  it('defaults solo travelers to one and leaves incomplete dates empty without changing state', () => {
    const state = at({ stage: 'requirements', requirements: { tripType: 'solo', destination: '京都', departureDate: '2026-12-01' } });
    const [form] = render(state, zh);
    expect(form.type === 'form' && form.fields).toEqual([
      { name: 'destination', label: '目的地', placeholder: '例如日本东京', value: '京都', suggestions: ['东京', '京都', '大阪', '奈良'] },
      { name: 'dates', label: '出行日期', value: null },
      { name: 'travelers', label: '出行人数', value: 1 },
      { name: 'preferences', label: '兴趣与特殊需求', placeholder: '例如美食、自然风景、无障碍设施', value: '', suggestions: ['美食', '温泉', '自然风光', '购物', '历史文化', '慢节奏'] },
    ]);
    expect(state.requirements).toEqual({ tripType: 'solo', destination: '京都', departureDate: '2026-12-01' });
  });

  it('prefills every field when editing a review, including explicit solo traveler counts', () => {
    const review = at({ stage: 'review', preamble: 'draft', requirements: { tripType: 'solo', destination: 'Kyoto', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 3, preferences: 'Food' } });
    const { state } = reduce(review, { type: 'edit' });
    expect(state.stage).toBe('requirements');
    const [form] = render(state, en);
    expect(form.type === 'form' && form.fields).toMatchObject([
      { name: 'destination', value: 'Kyoto' },
      { name: 'dates', value: { start: '2026-12-01', end: '2026-12-03' } },
      { name: 'travelers', value: 3 },
      { name: 'preferences', value: 'Food' },
    ]);
  });

  it('clarify for destination renders a choice before the stage components', () => {
    const components = render(
      at({ stage: 'requirements', requirements: { tripType: 'solo' }, clarify: { field: 'destination', question: '想去哪里？', options: ['巴厘岛', '曼谷'] } }),
      zh,
    );
    expect(types(components)).toEqual(['choice', 'form']);
    expect(components[0]).toMatchObject({ command: 'set_destination', title: '想去哪里？' });
  });

  it('review shows stays and confirm/edit; confirmed shows edit only', () => {
    // The panel is the only hotel list under a draft.
    expect(types(render(at({ stage: 'review', preamble: 'x', stays: hotels }), zh))).toEqual(['buttons']);
    expect(types(render(at({ stage: 'review', preamble: 'x' }), zh))).toEqual(['buttons']);
    const [buttons] = render(at({ stage: 'confirmed', preamble: 'x' }), en);
    expect(buttons.type === 'buttons' && buttons.buttons.map((b) => b.command)).toEqual(['edit']);
  });

  it('result cards replace stage components and add resume outside idle', () => {
    expect(types(render(at({ results: [hotels] }), zh))).toEqual(['cards']);
    expect(types(render(at({ stage: 'requirements', results: [hotels] }), zh))).toEqual(['cards', 'buttons']);
    expect(types(render(at({ results: [{ panel: null, items: [] }] }), zh))).toEqual([]);
  });
});

describe('choose_stay', () => {
  const hotel = { ref: 'h2', id: '2', title: { original: 'Miyako Hotel', translation: null }, address: null, price: null, rating: null, url: null, image: null, details: [], amenities: [], summary: null };
  const s = at({ stage: 'review', stays: { panel: 'hotels', items: [hotel] } });
  it('names the hotel and nights, 1-based, in the user message and the reply', () => {
    const command = { type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 2 } } as const;
    expect(describeCommand(command, en, s)).toBe('Stay at Miyako Hotel for nights 1–3');
    expect(describeCommand({ ...command, nights: { from: 1, to: 1 } }, zh, s)).toBe('第 2 晚住Miyako Hotel');
    expect(stageMessage(s, en, command)).toBe('Updated nights 1–3: Miyako Hotel.');
  });
});

describe('stageMessage / describe', () => {
  it('prefers the clarify question', () => {
    expect(stageMessage(at({ stage: 'trip_type' }), zh)).toBe('请选择旅游类型。');
    expect(stageMessage(at({ stage: 'requirements', clarify: { field: 'other', question: '几月出发？', options: [] } }), zh)).toBe('几月出发？');
    expect(stageMessage(at({ stage: 'confirmed' }), en)).toBe('Your itinerary has been confirmed and saved.');
  });
  it('turns commands into readable user messages', () => {
    expect(describeCommand({ type: 'message', text: '去杭州' }, zh, at({}))).toBe('去杭州');
    expect(describeCommand({ type: 'set_trip_type', value: 'family' }, zh, at({}))).toBe('亲子游');
    expect(describeCommand({ type: 'submit_requirements', values: { travelers: 4, departureDate: '2026-12-01' } }, zh, at({}))).toBe('出行人数：4');
    expect(describeCommand({ type: 'confirm' }, en, at({}))).toBe('Confirm itinerary');
  });
  it('describes submitted values in form order with a combined date range in Chinese', () => {
    expect(describeCommand({ type: 'submit_requirements', values: { destination: '京都', tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, preferences: '美食、慢节奏', budget: 100000, budgetCurrency: 'JPY' } }, zh, at({})))
      .toBe('目的地：京都\n出行日期：2026-12-01 → 2026-12-03\n出行人数：4\n兴趣与特殊需求：美食、慢节奏');
    expect(describeCommand({ type: 'submit_requirements', values: { preferences: '' } }, zh, at({}))).toBe('');
    expect(describeCommand({ type: 'submit_requirements', values: {} }, en, at({}))).toBe('');
  });
});

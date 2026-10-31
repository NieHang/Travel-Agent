import type { Component, ResultGroup } from '@autix/contracts';
import { initialState, type TripState } from './state.js';
import { copy } from './copy.js';
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

  it('requirements form asks only for missing fields, both dates together, plus preferences', () => {
    const [form] = render(at({ stage: 'requirements', requirements: { tripType: 'solo', destination: '杭州', departureDate: '2026-12-01' } }), zh);
    expect(form.type === 'form' && form.fields.map((f) => f.name)).toEqual(['departureDate', 'returnDate', 'travelers', 'preferences']);
    expect(form.type === 'form' && form.initialValues).toMatchObject({ destination: '杭州', departureDate: '2026-12-01' });
    expect(form.type === 'form' && form.submitLabel).toBe('生成路线草案');
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
    expect(types(render(at({ stage: 'review', itinerary: 'x', stays: hotels }), zh))).toEqual(['cards', 'buttons']);
    expect(types(render(at({ stage: 'review', itinerary: 'x' }), zh))).toEqual(['buttons']);
    const [buttons] = render(at({ stage: 'confirmed', itinerary: 'x' }), en);
    expect(buttons.type === 'buttons' && buttons.buttons.map((b) => b.command)).toEqual(['edit']);
  });

  it('result cards replace stage components and add resume outside idle', () => {
    expect(types(render(at({ results: [hotels] }), zh))).toEqual(['cards']);
    expect(types(render(at({ stage: 'requirements', results: [hotels] }), zh))).toEqual(['cards', 'buttons']);
    expect(types(render(at({ results: [{ panel: null, items: [] }] }), zh))).toEqual([]);
  });
});

describe('stageMessage / describe', () => {
  it('prefers the clarify question', () => {
    expect(stageMessage(at({ stage: 'trip_type' }), zh)).toBe('请选择旅游类型。');
    expect(stageMessage(at({ stage: 'requirements', clarify: { field: 'other', question: '几月出发？', options: [] } }), zh)).toBe('几月出发？');
    expect(stageMessage(at({ stage: 'confirmed' }), en)).toBe('Your itinerary has been confirmed and saved.');
  });
  it('turns commands into readable user messages', () => {
    expect(describeCommand({ type: 'message', text: '去杭州' }, zh)).toBe('去杭州');
    expect(describeCommand({ type: 'set_trip_type', value: 'family' }, zh)).toBe('亲子游');
    expect(describeCommand({ type: 'submit_requirements', values: { travelers: 4, departureDate: '2026-12-01' } }, zh)).toBe('出发日期：2026-12-01\n出行人数：4');
    expect(describeCommand({ type: 'confirm' }, en)).toBe('Confirm itinerary');
  });
});

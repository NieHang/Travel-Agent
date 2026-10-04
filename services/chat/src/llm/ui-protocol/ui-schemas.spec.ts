import {
  validatedAIUIResponseSchema as aiUIResponseSchema,
  uiResponseSchema,
  uiActionSchema,
  formFieldSchema,
  uiModelOutputSchema,
  validatedUIModelOutputSchema,
  chatRequestSchema,
} from './ui-schemas.js';
import { emptyRequirements } from './ui-test.fixtures.js';

export const examples = [
  { id: 't', type: 'text', content: '你好', format: 'markdown' },
  {
    id: 's',
    type: 'selection',
    purpose: 'trip_type',
    title: '旅游类型',
    mode: 'single',
    options: [{ value: 'solo', label: '个人游', description: null }],
  },
  {
    id: 'f',
    type: 'form',
    title: '需求',
    fields: [
      {
        type: 'input',
        name: 'destination',
        label: '目的地',
        required: true,
        placeholder: null,
      },
    ],
    submitLabel: '提交',
  },
  {
    id: 'c',
    type: 'confirmation',
    title: '确认路线',
    summary: '东京三日',
    confirmLabel: '确认',
    cancelLabel: '取消',
  },
  {
    id: 'd',
    type: 'card',
    title: '西湖',
    category: 'place',
    description: '地点详情',
    details: [{ label: '城市', value: '杭州' }],
    sourceStatus: 'unverified',
  },
  {
    id: 'p',
    type: 'steps',
    title: '规划进度',
    items: [{ id: 'review', label: '确认', status: 'current' }],
  },
  {
    id: 'tb',
    type: 'table',
    title: '酒店',
    columns: [{ key: 'name', label: '名称' }],
    rows: [{ id: '1', cells: [{ key: 'name', value: '待查询' }] }],
  },
  {
    id: 'b',
    type: 'action_buttons',
    buttons: [{ id: 'edit', label: '修改', action: 'edit_itinerary' }],
  },
];

describe('UI protocol schemas', () => {
  const envelope = {
    semantics: {
      intent: 'general',
      operation: 'answer',
      replyLanguage: 'en',
      requirements: emptyRequirements,
    },
    response: { message: '', intent: 'general', components: [examples[0]] },
  };
  it('requires a strict semantic envelope and all nullable requirement keys', () => {
    expect(uiModelOutputSchema.safeParse(envelope).success).toBe(true);
    expect(uiModelOutputSchema.safeParse(envelope.response).success).toBe(
      false,
    );
    expect(
      uiModelOutputSchema.safeParse({
        ...envelope,
        semantics: { ...envelope.semantics, requirements: {} },
      }).success,
    ).toBe(false);
    expect(
      uiModelOutputSchema.safeParse({
        ...envelope,
        semantics: { ...envelope.semantics, operation: 'confirmed' },
      }).success,
    ).toBe(false);
    expect(
      uiModelOutputSchema.safeParse({
        ...envelope,
        semantics: {
          ...envelope.semantics,
          requirements: { ...emptyRequirements, tripType: 'holiday' },
        },
      }).success,
    ).toBe(false);
  });
  it('rejects conflicting intents, non-planning updates and duplicate identifiers', () => {
    expect(
      validatedUIModelOutputSchema.safeParse({
        ...envelope,
        semantics: { ...envelope.semantics, intent: 'hotel_search' },
      }).success,
    ).toBe(false);
    expect(
      validatedUIModelOutputSchema.safeParse({
        ...envelope,
        semantics: {
          ...envelope.semantics,
          requirements: { ...emptyRequirements, budget: 500 },
        },
      }).success,
    ).toBe(false);
    expect(
      validatedUIModelOutputSchema.safeParse({
        ...envelope,
        semantics: { ...envelope.semantics, operation: 'request_confirmation' },
      }).success,
    ).toBe(false);
    expect(
      validatedUIModelOutputSchema.safeParse({
        ...envelope,
        response: {
          ...envelope.response,
          components: [examples[0], examples[0]],
        },
      }).success,
    ).toBe(false);
  });
  it('accepts optional locale and rejects invalid language tags', () => {
    expect(
      chatRequestSchema.parse({ sessionId: 's', input: 'hi', locale: 'en-US' })
        .locale,
    ).toBe('en-US');
    expect(
      chatRequestSchema.safeParse({
        sessionId: 's',
        input: 'hi',
        locale: 'not a language',
      }).success,
    ).toBe(false);
  });
  it.each(examples)('accepts $type', (component) => {
    expect(uiResponseSchema.parse(component)).toEqual(component);
  });
  it.each(['input', 'textarea', 'date', 'number', 'select'])(
    'accepts %s field',
    (type) => {
      const field = {
        type,
        name: 'field',
        label: '字段',
        required: true,
        ...(type === 'number'
          ? { min: 0, max: null }
          : type === 'select'
            ? { options: [{ value: 'a', label: 'A', description: null }] }
            : { placeholder: null }),
      };
      expect(formFieldSchema.safeParse(field).success).toBe(true);
    },
  );
  it.each([
    { type: 'unknown', id: '1' },
    { type: 'card', id: '1' },
    { ...examples[0], format: 'html' },
    { ...examples[1], mode: 'other' },
  ])('rejects malformed component', (value) => {
    expect(uiResponseSchema.safeParse(value).success).toBe(false);
  });
  it('requires nonempty components and rejects duplicate component IDs', () => {
    expect(
      aiUIResponseSchema.safeParse({
        message: '',
        intent: 'general',
        components: [],
      }).success,
    ).toBe(false);
    expect(
      aiUIResponseSchema.safeParse({
        message: '',
        intent: 'general',
        components: [examples[0], examples[0]],
      }).success,
    ).toBe(false);
  });
  it.each([
    { type: 'selection', componentId: 's', values: ['solo'] },
    {
      type: 'form_submit',
      componentId: 'f',
      values: [{ name: 'budget', value: 500 }],
    },
    { type: 'confirmation', componentId: 'c', confirmed: true },
    { type: 'button_click', componentId: 'b', buttonId: 'edit' },
  ])('accepts $type action', (action) =>
    expect(uiActionSchema.parse(action)).toEqual(action),
  );
  it('rejects arbitrary state transitions', () => {
    expect(
      uiActionSchema.safeParse({
        type: 'confirmation',
        componentId: 'c',
        confirmed: true,
        stage: 'confirmed',
      }).success,
    ).toBe(false);
  });
});

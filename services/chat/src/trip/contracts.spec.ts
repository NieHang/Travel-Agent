import {
  CommandSchema,
  ComponentSchema,
  MessageMetadataSchema,
  RequirementsSchema,
  SendTurnRequestSchema,
  TripStreamEventSchema,
  type ResultItem,
} from '@autix/contracts';

const item: ResultItem = {
  ref: 'h1',
  id: '43615',
  title: { original: 'Casa do Fado Alfama', translation: '阿尔法玛法朵之家' },
  address: null,
  price: { amount: 118, currency: 'EUR' },
  rating: 4,
  url: 'https://rollinggo.ai/h/43615',
  image: null,
  details: [],
  amenities: [{ original: 'Kitchen', translation: '厨房' }],
  summary: null,
};

describe('trip contracts', () => {
  it('accepts every command and rejects unknown fields', () => {
    for (const command of [
      { type: 'message', text: '去杭州' },
      { type: 'set_trip_type', value: 'family' },
      { type: 'set_destination', value: 'Bali' },
      { type: 'submit_requirements', values: { travelers: 2, departureDate: '2026-12-01' } },
      { type: 'confirm' },
      { type: 'edit' },
      { type: 'resume' },
    ])
      expect(CommandSchema.safeParse(command).success).toBe(true);
    expect(CommandSchema.safeParse({ type: 'confirm', extra: 1 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'message', text: '   ' }).success).toBe(false);
  });

  it('keeps requirements partial and strict', () => {
    expect(RequirementsSchema.safeParse({}).success).toBe(true);
    expect(RequirementsSchema.safeParse({ travelers: 0 }).success).toBe(false);
    expect(RequirementsSchema.safeParse({ travelers: 100 }).success).toBe(true);
    expect(RequirementsSchema.safeParse({ travelers: 101 }).success).toBe(false);
    expect(RequirementsSchema.safeParse({ hotel: 'x' }).success).toBe(false);
  });

  it('validates field-specific values and rejects the old form shape', () => {
    const form = {
      type: 'form', command: 'submit_requirements', title: 'Requirements', submitLabel: 'Submit',
      fields: [
        { name: 'destination', label: 'Destination', placeholder: null, value: ' Kyoto ', suggestions: ['Tokyo'] },
        { name: 'dates', label: 'Travel dates', value: { start: '2026-12-01', end: '2026-12-03' } },
        { name: 'travelers', label: 'Travelers', value: 100 },
        { name: 'preferences', label: 'Preferences', placeholder: null, value: '', suggestions: ['Food'] },
      ],
    };
    expect(ComponentSchema.parse(form)).toMatchObject({ fields: [{ value: 'Kyoto' }, { value: { start: '2026-12-01', end: '2026-12-03' } }, { value: 100 }, { value: '' }] });
    expect(ComponentSchema.safeParse({ ...form, initialValues: {} }).success).toBe(false);
    for (const field of [
      { name: 'destination', label: 'Destination', placeholder: null, value: null, suggestions: [] },
      { name: 'dates', label: 'Travel dates', value: null },
      { name: 'travelers', label: 'Travelers', value: null },
    ]) expect(ComponentSchema.safeParse({ ...form, fields: [field] }).success).toBe(true);
    for (const field of [
      { name: 'destination', label: 'Destination', placeholder: null, value: ' ', suggestions: [] },
      { name: 'destination', label: 'Destination', placeholder: null, value: 'Kyoto', suggestions: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { name: 'dates', label: 'Travel dates', value: { start: '2026-12-01' } },
      { name: 'dates', label: 'Travel dates', value: { start: 'tomorrow', end: '2026-12-03' } },
      { name: 'travelers', label: 'Travelers', value: 0 },
      { name: 'travelers', label: 'Travelers', value: 101 },
      { name: 'travelers', label: 'Travelers', value: 1.5 },
      { name: 'travelers', label: 'Travelers', value: 2, required: true },
      { name: 'preferences', label: 'Preferences', placeholder: null, value: null, suggestions: [] },
      { name: 'preferences', label: 'Preferences', placeholder: null, value: 'x'.repeat(4001), suggestions: [] },
      { name: 'preferences', label: 'Preferences', placeholder: null, value: '', suggestions: Array.from({ length: 9 }, () => 'Food') },
      { name: 'departureDate', kind: 'date', label: 'Departure date', required: true, placeholder: null, min: null, max: null },
    ]) expect(ComponentSchema.safeParse({ ...form, fields: [field] }).success).toBe(false);
  });

  it('preserves the command in user message metadata', () => {
    expect(MessageMetadataSchema.parse({ command: { type: 'set_trip_type', value: 'solo' } })).toEqual({ command: { type: 'set_trip_type', value: 'solo' } });
  });

  it('validates the turn request', () => {
    expect(
      SendTurnRequestSchema.safeParse({ revision: 3, command: { type: 'edit' }, locale: 'zh' }).success,
    ).toBe(true);
    expect(SendTurnRequestSchema.safeParse({ revision: -1, command: { type: 'edit' } }).success).toBe(false);
    expect(SendTurnRequestSchema.safeParse({ revision: 0, command: { type: 'edit' }, locale: 'fr' }).success).toBe(false);
  });

  it('parses the five components and the stream events', () => {
    expect(ComponentSchema.safeParse({ type: 'cards', items: [item] }).success).toBe(true);
    expect(
      ComponentSchema.safeParse({ type: 'buttons', buttons: [{ command: 'confirm', label: '确认路线' }] }).success,
    ).toBe(true);
    expect(TripStreamEventSchema.safeParse({ type: 'status', phase: 'searching' }).success).toBe(true);
    expect(TripStreamEventSchema.safeParse({ type: 'text', delta: '第' }).success).toBe(true);
    expect(TripStreamEventSchema.safeParse({ type: 'error', code: 'MODEL_FAILED' }).success).toBe(true);
    expect(TripStreamEventSchema.safeParse({ type: 'progress' }).success).toBe(false);
  });
});

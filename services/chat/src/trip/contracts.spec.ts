import {
  CommandSchema,
  ComponentSchema,
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
    expect(RequirementsSchema.safeParse({ hotel: 'x' }).success).toBe(false);
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

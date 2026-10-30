import { z } from 'zod';
import { MessageSchema } from './chat';

export const TRIP_TYPES = ['business', 'family', 'solo', 'couple', 'friends'] as const;
export const TripTypeSchema = z.enum(TRIP_TYPES);
export type TripType = z.infer<typeof TripTypeSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RequirementsSchema = z
  .object({
    destination: z.string().trim().min(1).max(200),
    tripType: TripTypeSchema,
    departureDate: isoDate,
    returnDate: isoDate,
    travelers: z.number().int().min(1).max(100),
    preferences: z.string().max(4000),
    budget: z.number().nonnegative(),
    budgetCurrency: z.string().regex(/^[A-Z]{3}$/),
  })
  .partial()
  .strict();
export type Requirements = z.infer<typeof RequirementsSchema>;

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('set_trip_type'), value: TripTypeSchema }).strict(),
  z.object({ type: z.literal('set_destination'), value: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal('submit_requirements'), values: RequirementsSchema }).strict(),
  z.object({ type: z.literal('confirm') }).strict(),
  z.object({ type: z.literal('edit') }).strict(),
  z.object({ type: z.literal('resume') }).strict(),
]);
export type Command = z.infer<typeof CommandSchema>;

/** Provider text: `original` is checked against the tool result, `translation` is not. */
export const LocalizedTextSchema = z
  .object({ original: z.string().min(1).max(300), translation: z.string().max(300).nullable() })
  .strict();
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const PanelSchema = z.enum(['hotels', 'routes', 'hotspots']);
export type Panel = z.infer<typeof PanelSchema>;

export const ResultItemSchema = z
  .object({
    ref: z.string().min(1).max(20),
    id: z.string().max(200).nullable(),
    title: LocalizedTextSchema,
    address: LocalizedTextSchema.nullable(),
    price: z.object({ amount: z.number().nonnegative(), currency: z.string().min(1).max(10) }).strict().nullable(),
    rating: z.number().min(0).max(10).nullable(),
    url: z.string().url().nullable(),
    image: z.string().url().nullable(),
    details: z.array(z.object({ label: z.string().min(1).max(50), value: LocalizedTextSchema }).strict()).max(6),
    amenities: z.array(LocalizedTextSchema).max(30),
    summary: z.string().max(500).nullable(),
  })
  .strict();
export type ResultItem = z.infer<typeof ResultItemSchema>;

export const ResultGroupSchema = z
  .object({ panel: PanelSchema.nullable(), items: z.array(ResultItemSchema).max(20) })
  .strict();
export type ResultGroup = z.infer<typeof ResultGroupSchema>;

export const FieldSchema = z
  .object({
    name: z.enum(['destination', 'departureDate', 'returnDate', 'travelers', 'preferences']),
    kind: z.enum(['text', 'textarea', 'date', 'number']),
    label: z.string().min(1),
    required: z.boolean(),
    placeholder: z.string().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
  })
  .strict();
export type Field = z.infer<typeof FieldSchema>;

const label = z.string().min(1).max(200);
export const ComponentSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('choice'),
      command: z.enum(['set_trip_type', 'set_destination']),
      title: label,
      options: z
        .array(z.object({ value: label, label, description: z.string().max(200).nullable() }).strict())
        .min(1)
        .max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal('form'),
      command: z.literal('submit_requirements'),
      title: label,
      fields: z.array(FieldSchema).min(1).max(6),
      initialValues: RequirementsSchema,
      submitLabel: label,
    })
    .strict(),
  z.object({ type: z.literal('cards'), items: z.array(ResultItemSchema).min(1).max(20) }).strict(),
  z
    .object({
      type: z.literal('buttons'),
      buttons: z.array(z.object({ command: z.enum(['confirm', 'edit', 'resume']), label }).strict()).min(1),
    })
    .strict(),
]);
export type Component = z.infer<typeof ComponentSchema>;

export const TripViewSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    status: z.enum(['collecting', 'draft', 'confirmed']),
    destination: z.string().nullable(),
    departureDate: z.string().nullable(),
    returnDate: z.string().nullable(),
    travelers: z.number().int().nullable(),
    budget: z.number().nullable(),
    budgetCurrency: z.string().nullable(),
    itineraryMarkdown: z.string().nullable(),
    days: z.array(
      z.object({
        title: z.string(),
        stops: z.array(z.object({ name: z.string(), note: z.string().nullable(), time: z.string().nullable() })),
        stay: ResultItemSchema.nullable(),
      }),
    ),
    hotels: z.array(ResultItemSchema),
    routes: z.array(ResultItemSchema),
    hotspots: z.array(ResultItemSchema),
  })
  .strict();
export type TripView = z.infer<typeof TripViewSchema>;

export const TripUIStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  trip: TripViewSchema.nullable(),
  components: z.array(ComponentSchema),
});
export type TripUIState = z.infer<typeof TripUIStateSchema>;

export const SendTurnRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    command: CommandSchema,
    locale: z.enum(['zh', 'en']).optional(),
  })
  .strict();
export type SendTurnRequest = z.infer<typeof SendTurnRequestSchema>;

export const StatusPhaseSchema = z.enum(['searching', 'writing', 'organizing']);
export type StatusPhase = z.infer<typeof StatusPhaseSchema>;

export const TripStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), userMessage: MessageSchema }),
  z.object({ type: z.literal('status'), phase: StatusPhaseSchema }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({
    type: z.literal('done'),
    message: MessageSchema,
    components: z.array(ComponentSchema),
    trip: TripViewSchema.nullable(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['MODEL_FAILED', 'CONFLICT']),
    message: MessageSchema.optional(),
  }),
]);
export type TripStreamEvent = z.infer<typeof TripStreamEventSchema>;

import { z } from 'zod';

const label = z.string().min(1).max(4000).regex(/\S/);
const id = z.string().min(1).max(200);
const optionSchema = z
  .object({ value: id, label, description: z.string().nullable() })
  .strict();
const fieldBase = { name: id, label, required: z.boolean() };
const placeholder = z.string().nullable();
export const formFieldSchema = z.discriminatedUnion('type', [
  z.object({ ...fieldBase, type: z.literal('input'), placeholder }).strict(),
  z.object({ ...fieldBase, type: z.literal('textarea'), placeholder }).strict(),
  z.object({ ...fieldBase, type: z.literal('date'), placeholder }).strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal('number'),
      min: z.number().finite().nullable(),
      max: z.number().finite().nullable(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal('select'),
      options: z.array(optionSchema).min(1).max(30),
    })
    .strict(),
]);
export const textSchema = z
  .object({
    id,
    type: z.literal('text'),
    content: z.string(),
    format: z.enum(['plain', 'markdown']),
  })
  .strict();
export const selectionSchema = z
  .object({
    id,
    type: z.literal('selection'),
    purpose: z.enum(['trip_type', 'query_filter', 'query_candidate']),
    title: label,
    mode: z.enum(['single', 'multiple']),
    options: z.array(optionSchema).min(1).max(30),
  })
  .strict();
export const formSchema = z
  .object({
    id,
    type: z.literal('form'),
    title: label,
    fields: z.array(formFieldSchema).min(1).max(30),
    submitLabel: label,
  })
  .strict();
export const confirmationSchema = z
  .object({
    id,
    type: z.literal('confirmation'),
    title: label,
    summary: label,
    confirmLabel: label,
    cancelLabel: label,
  })
  .strict();
export const cardSchema = z
  .object({
    id,
    type: z.literal('card'),
    title: label,
    category: z.enum(['place', 'hotel', 'flight', 'itinerary']),
    description: z.string(),
    details: z.array(z.object({ label, value: z.string() }).strict()).max(30),
    sourceStatus: z.enum(['verified', 'unverified']),
  })
  .strict();
export const stepsSchema = z
  .object({
    id,
    type: z.literal('steps'),
    title: label,
    items: z
      .array(
        z
          .object({
            id,
            label,
            status: z.enum(['pending', 'current', 'completed']),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const tableSchema = z
  .object({
    id,
    type: z.literal('table'),
    title: label,
    columns: z
      .array(z.object({ key: id, label }).strict())
      .min(1)
      .max(20),
    rows: z
      .array(
        z
          .object({
            id,
            cells: z
              .array(z.object({ key: id, value: z.string() }).strict())
              .max(20),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const buttonActionSchema = z.enum([
  'view_details',
  'refine_search',
  'confirm_itinerary',
  'edit_itinerary',
  'resume_planning',
]);
export const actionButtonsSchema = z
  .object({
    id,
    type: z.literal('action_buttons'),
    buttons: z
      .array(z.object({ id, label, action: buttonActionSchema }).strict())
      .min(1)
      .max(10),
  })
  .strict();
export const uiResponseSchema = z.discriminatedUnion('type', [
  textSchema,
  selectionSchema,
  formSchema,
  confirmationSchema,
  cardSchema,
  stepsSchema,
  tableSchema,
  actionButtonsSchema,
]);
export const uiIntentSchema = z.enum([
  'trip_planning',
  'hotel_search',
  'place_details',
  'flight_search',
  'general',
]);
export const aiUIResponseSchema = z
  .object({
    message: z.string(),
    intent: uiIntentSchema,
    components: z.array(uiResponseSchema).min(1).max(30),
  })
  .strict();
// Keep opaque refinements outside the Schema sent to OpenAI strict Structured Outputs.
export const validatedAIUIResponseSchema = aiUIResponseSchema.superRefine(
  (response, ctx) => {
    const unique = (keys: string[], path: (string | number)[]) => {
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate identifiers',
          path,
        });
    };
    unique(
      response.components.map((c) => c.id),
      ['components'],
    );
    response.components.forEach((component, i) => {
      if (component.type === 'selection')
        unique(
          component.options.map((o) => o.value),
          ['components', i, 'options'],
        );
      if (component.type === 'form') {
        unique(
          component.fields.map((f) => f.name),
          ['components', i, 'fields'],
        );
        for (const field of component.fields) {
          if (field.type === 'select')
            unique(
              field.options.map((o) => o.value),
              ['components', i, 'fields'],
            );
          if (
            field.type === 'number' &&
            field.min !== null &&
            field.max !== null &&
            field.min > field.max
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Invalid numeric bounds',
            });
        }
      }
      if (component.type === 'action_buttons')
        unique(
          component.buttons.map((b) => b.id),
          ['components', i, 'buttons'],
        );
      if (component.type === 'steps')
        unique(
          component.items.map((s) => s.id),
          ['components', i, 'items'],
        );
      if (component.type === 'table') {
        unique(
          component.columns.map((c) => c.key),
          ['components', i, 'columns'],
        );
        unique(
          component.rows.map((r) => r.id),
          ['components', i, 'rows'],
        );
        for (const row of component.rows) {
          unique(
            row.cells.map((c) => c.key),
            ['components', i, 'rows'],
          );
          if (
            row.cells.length !== component.columns.length ||
            row.cells.some(
              (c) => !component.columns.some((col) => col.key === c.key),
            )
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Cells must match columns',
            });
        }
      }
    });
  },
);
export const uiActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('selection'),
      componentId: id,
      values: z.array(id).min(1).max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal('form_submit'),
      componentId: id,
      values: z
        .array(
          z
            .object({
              name: id,
              value: z.union([
                z.string().max(4000),
                z.number().finite(),
                z.boolean(),
                z.null(),
              ]),
            })
            .strict(),
        )
        .max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal('confirmation'),
      componentId: id,
      confirmed: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal('button_click'), componentId: id, buttonId: id })
    .strict(),
]);
// Syntax validation is independent of which display dictionaries are installed.
export const localeSchema = z
  .string()
  .min(2)
  .max(100)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'Invalid language tag');

export type UIResponse = z.infer<typeof uiResponseSchema>;
export type UIAction = z.infer<typeof uiActionSchema>;
export type AIUIResponse = z.infer<typeof aiUIResponseSchema>;
export type UIFormField = z.infer<typeof formFieldSchema>;
export type UIIntent = z.infer<typeof uiIntentSchema>;

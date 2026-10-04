import { z } from 'zod';
import {
  uiIntentSchema,
  aiUIResponseSchema,
  validatedAIUIResponseSchema,
  uiActionSchema,
  localeSchema,
} from '@autix/contracts';
export {
  formFieldSchema,
  textSchema,
  selectionSchema,
  formSchema,
  confirmationSchema,
  cardSchema,
  stepsSchema,
  tableSchema,
  buttonActionSchema,
  actionButtonsSchema,
  uiResponseSchema,
  uiIntentSchema,
  aiUIResponseSchema,
  validatedAIUIResponseSchema,
  uiActionSchema,
  localeSchema,
} from '@autix/contracts';
const label = z.string().min(1).max(4000).regex(/\S/);
const id = z.string().min(1).max(200);
export const planningRequirementsSchema = z
  .object({
    destination: label.nullable(),
    tripType: z.enum(['business', 'family', 'solo', 'couple']).nullable(),
    departureDate: z.string().nullable(),
    returnDate: z.string().nullable(),
    travelers: z.number().finite().nullable(),
    budget: z.number().finite().nullable(),
    budgetCurrency: z.string().nullable(),
    preferences: z.string().max(4000).nullable(),
  })
  .strict();
export const uiSemanticsSchema = z
  .object({
    intent: uiIntentSchema,
    operation: z.enum([
      'answer',
      'update_requirements',
      'request_confirmation',
      'cancel_confirmation',
      'resume_planning',
    ]),
    replyLanguage: z.string().min(2).max(100),
    requirements: planningRequirementsSchema,
  })
  .strict();
export const uiModelOutputSchema = z
  .object({ semantics: uiSemanticsSchema, response: aiUIResponseSchema })
  .strict();
export const validatedUIModelOutputSchema = uiModelOutputSchema.superRefine(
  (output, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const { semantics, response } = output;
    if (semantics.intent !== response.intent) fail('Semantic intent mismatch');
    const hasPatch = Object.values(semantics.requirements).some(
      (v) => v !== null,
    );
    if (
      semantics.intent !== 'trip_planning' &&
      semantics.operation !== 'answer'
    )
      fail('Only planning permits workflow operations');
    if (semantics.operation !== 'update_requirements' && hasPatch)
      fail('Only requirement updates permit a planning patch');
    if (!localeSchema.safeParse(semantics.replyLanguage).success)
      fail('Invalid reply language');
    const parsed = validatedAIUIResponseSchema.safeParse(response);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ ...issue, path: ['response', ...issue.path] });
  },
);
export const chatRequestSchema = z
  .object({
    sessionId: id.trim().min(1),
    input: z.string().trim().min(1).max(8000),
    locale: localeSchema.optional(),
  })
  .strict();
export const actionRequestSchema = z
  .object({
    sessionId: id.trim().min(1),
    action: uiActionSchema,
    locale: localeSchema.optional(),
  })
  .strict();

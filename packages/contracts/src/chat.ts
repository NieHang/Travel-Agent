import { z } from 'zod';
import { uiResponseSchema, uiActionSchema, localeSchema } from './ui';
import { TripSnapshotSchema } from './trip';
import { RequirementSchema } from './requirement';

export const ComponentInteractionStateSchema = z.object({
  sourceMessageId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  active: z.boolean(),
});
export type ComponentInteractionState = z.infer<
  typeof ComponentInteractionStateSchema
>;

export const MessageMetadataSchema = z.object({
  components: z.array(uiResponseSchema).optional(),
  interactionState: ComponentInteractionStateSchema.optional(),
  trip: TripSnapshotSchema.nullable().optional(),
  requirements: z.array(RequirementSchema).optional(),
  requirementError: z.literal(true).optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(['USER', 'ASSISTANT']),
  content: z.string(),
  status: z.enum(['complete', 'partial', 'error']),
  metadata: MessageMetadataSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SendMessageRequestSchema = z.union([
  z
    .object({
      content: z.string().trim().min(1).max(4000),
      locale: localeSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: uiActionSchema,
      sourceMessageId: z.string().min(1),
      revision: z.number().int().nonnegative(),
      locale: localeSchema.optional(),
    })
    .strict(),
]);
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('user_message'),
    data: z.object({ message: MessageSchema }),
  }),
  z.object({
    event: z.literal('delta'),
    data: z.object({ text: z.string() }),
  }),
  z.object({
    event: z.literal('requirement'),
    data: z.object({ requirements: z.array(RequirementSchema) }),
  }),
  z.object({
    event: z.literal('done'),
    data: z.object({ message: MessageSchema }),
  }),
  z.object({
    event: z.literal('error'),
    data: z.object({ code: z.literal('MODEL_FAILED'), message: MessageSchema }),
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

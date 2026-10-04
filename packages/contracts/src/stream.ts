import { z } from 'zod';
import { MessageSchema, ComponentInteractionStateSchema } from './chat';
import { uiResponseSchema } from './ui';
import { TripSnapshotSchema } from './trip';

export const UIConversationStateSchema = z.object({
  trip: TripSnapshotSchema.nullable(),
  activeMessage: MessageSchema.nullable(),
});
export type UIConversationState = z.infer<typeof UIConversationStateSchema>;

export const ProgressPayloadSchema = z
  .object({
    agent: z.string(),
    step: z.number().int().min(1),
    totalSteps: z.number().int().min(1),
    status: z.enum(['started', 'completed', 'failed']),
    label: z.string(),
  })
  .refine((p) => p.step <= p.totalSteps);
export type ProgressPayload = z.infer<typeof ProgressPayloadSchema>;
const base = { timestamp: z.string().datetime() };
export const StreamMessageSchema = z.discriminatedUnion('messageType', [
  z.object({
    ...base,
    messageType: z.literal('markdown'),
    payload: z.object({
      messageId: z.string(),
      content: z.string(),
      isChunk: z.boolean(),
    }),
  }),
  z.object({
    ...base,
    messageType: z.literal('ui'),
    payload: z.object({
      messageId: z.string(),
      components: z.array(uiResponseSchema),
      thinking: z.string().optional(),
      interactionState: ComponentInteractionStateSchema.optional(),
    }),
  }),
  z.object({
    ...base,
    messageType: z.literal('meta'),
    payload: z.object({
      conversationId: z.string(),
      userMessage: MessageSchema.optional(),
      trip: TripSnapshotSchema.nullable().optional(),
    }),
  }),
  z.object({
    ...base,
    messageType: z.literal('progress'),
    payload: ProgressPayloadSchema,
  }),
  z.object({
    ...base,
    messageType: z.literal('done'),
    payload: z.object({
      message: MessageSchema,
      trip: TripSnapshotSchema.nullable(),
    }),
  }),
  z.object({
    ...base,
    messageType: z.literal('error'),
    payload: z.object({ code: z.string(), message: MessageSchema.optional() }),
  }),
]);
export type StreamMessage = z.infer<typeof StreamMessageSchema>;
export type MarkdownPayload = Extract<
  StreamMessage,
  { messageType: 'markdown' }
>['payload'];
export type UIPayload = Extract<
  StreamMessage,
  { messageType: 'ui' }
>['payload'];
export type MetaPayload = Extract<
  StreamMessage,
  { messageType: 'meta' }
>['payload'];
export type ErrorPayload = Extract<
  StreamMessage,
  { messageType: 'error' }
>['payload'];

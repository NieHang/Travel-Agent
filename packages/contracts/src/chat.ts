import { z } from 'zod';
import { RequirementSchema } from './requirement';

export const MessageMetadataSchema = z.object({
  /** Components shown with this message; the client validates each entry (legacy types fall back). */
  components: z.array(z.unknown()).optional(),
  /** Trip revision these components belong to; only the current revision is interactive. */
  revision: z.number().int().nonnegative().optional(),
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

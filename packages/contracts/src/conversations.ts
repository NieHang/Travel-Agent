import { z } from "zod";

const TitleSchema = z.string().trim().min(1).max(60);

const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationRequestSchema = z.object({
  title: TitleSchema.optional(),
});
export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>;

export const RenameConversationRequestSchema = z.object({
  title: TitleSchema,
});
export type RenameConversationRequest = z.infer<
  typeof RenameConversationRequestSchema
>;

const LimitSchema = z.coerce.number().int().min(1).max(50).default(20);

export const ListConversationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: LimitSchema,
  q: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ListConversationsQuery = z.infer<
  typeof ListConversationsQuerySchema
>;

export const ListMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: LimitSchema,
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export type Page<T> = { items: T[]; nextCursor: string | null };

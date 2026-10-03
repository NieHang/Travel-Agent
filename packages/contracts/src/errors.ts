import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "TOKEN_MISSING",
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "INVALID_CREDENTIALS",
  "REFRESH_INVALID",
  "REFRESH_REUSED",
  "CONVERSATION_NOT_FOUND",
  "NOT_FOUND",
  "EMAIL_TAKEN",
  "RATE_LIMITED",
  "MODEL_FAILED",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

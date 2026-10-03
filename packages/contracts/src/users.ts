import { z } from "zod";
import { LocaleSchema, NicknameSchema } from "./auth";

export const UpdateMeRequestSchema = z
  .object({
    nickname: NicknameSchema.optional(),
    locale: LocaleSchema.optional(),
  })
  .refine((v) => v.nickname !== undefined || v.locale !== undefined, {
    message: "at least one field is required",
  });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

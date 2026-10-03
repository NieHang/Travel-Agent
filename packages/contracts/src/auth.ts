import { z } from "zod";

export const LocaleSchema = z.enum(["zh", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();
export type Email = z.infer<typeof EmailSchema>;

export const PasswordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, "must contain a letter")
  .regex(/[0-9]/, "must contain a digit");
export type Password = z.infer<typeof PasswordSchema>;

export const NicknameSchema = z.string().trim().min(1).max(20);
export type Nickname = z.infer<typeof NicknameSchema>;

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  nickname: NicknameSchema,
  locale: LocaleSchema.default("zh"),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  nickname: z.string(),
  locale: LocaleSchema,
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthResultSchema = z.object({
  accessToken: z.string(),
  user: UserSchema,
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

import { z } from "zod";

export const APP_NAME = "TravelAgent";

export const RequirementSchema = z.object({
  action: z.string().describe("唯一核心动作（动词+对象）"),
  constraints: z
    .array(z.string())
    .describe("文本中的明确约束，没有则返回空数组"),
  entities: z
    .array(z.string())
    .describe("文本中真实出现的名词，没有则返回空数组"),
});

export const RequirementResultSchema = z.object({
  requirements: z
    .array(RequirementSchema)
    .describe("从输入文本中抽取的需求，没有则返回空数组"),
});

export type RequirementResult = z.infer<typeof RequirementResultSchema>;

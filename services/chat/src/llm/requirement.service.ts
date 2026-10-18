import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';
import { createChatModel } from './model.factory.js';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt.js';

@Injectable()
export class RequirementService {
  private readonly prompt = ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);

  /** `signal` 中止时取消进行中的模型请求，调用随之被拒绝。 */
  async extract(input: string, signal?: AbortSignal): Promise<RequirementResult> {
    const messages = await this.prompt.formatMessages({ input });
    const model = createChatModel();
    return model
      .withStructuredOutput(RequirementResultSchema)
      .invoke(messages, { signal });
  }
}

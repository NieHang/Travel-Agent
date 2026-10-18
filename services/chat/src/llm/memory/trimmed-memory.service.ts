import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createRequire } from 'node:module';
import { getModelNameForTiktoken } from '@langchain/core/language_models/base';
import { trimMessages, type BaseMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { RunnableMemoryService } from './runnable-memory.service.js';

// Reuse LangChain's installed tokenizer and its bundled ranks without downloading them.
const requireFromCore = createRequire(
  import.meta.resolve('@langchain/core/messages'),
);
type Encoder = {
  encode: (text: string, allowed?: string[], disallowed?: string[]) => number[];
};
const { encodingForModel, getEncoding } = requireFromCore('js-tiktoken') as {
  encodingForModel: (model: string) => Encoder;
  getEncoding: (encoding: string) => Encoder;
};
const encoders = new Map<string, Encoder>();

// tiktoken only knows OpenAI models; others (e.g. deepseek-flash) get an estimate from o200k_base.
function encoderFor(modelName: string): Encoder {
  try {
    return encodingForModel(modelName);
  } catch {
    return getEncoding('o200k_base');
  }
}

@Injectable()
export class TrimmedMemoryService extends RunnableMemoryService {
  constructor(@Inject(RunnableMemoryService) memory: RunnableMemoryService) {
    super();
    this.useHistoryFrom(memory);
  }

  protected override async prepareMessages(
    messages: BaseMessage[],
    model: ChatOpenAI,
  ) {
    const modelName = getModelNameForTiktoken(model.model);
    let encoder = encoders.get(modelName);
    if (!encoder) {
      encoder = encoderFor(modelName);
      encoders.set(modelName, encoder);
    }
    const tokenizer = encoder;
    model.getNumTokens = async (content) => {
      const text =
        typeof content === 'string'
          ? content
          : content
              .map((block) =>
                typeof block === 'string'
                  ? block
                  : block.type === 'text' && 'text' in block
                    ? block.text
                    : '',
              )
              .join('');
      return tokenizer.encode(text, [], []).length;
    };
    const tokenCounter = async (items: BaseMessage[]) =>
      (await model.getNumTokensFromMessages(items)).totalCount;
    // Never drop the user's current input or the requirement-analysis instructions.
    if (
      (await tokenCounter([messages[0], messages[messages.length - 1]])) > 2000
    ) {
      throw new BadRequestException(
        'input exceeds the 2000 token context budget',
      );
    }
    return trimMessages(messages, {
      maxTokens: 2000,
      strategy: 'last',
      tokenCounter,
      includeSystem: true,
      startOn: 'human',
      allowPartial: false,
    });
  }
}

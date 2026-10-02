import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { SystemMessage, ToolMessage } from '@langchain/core/messages';
import { createChatModel } from './model.factory.js';
import { buildRequirementPrompt } from './requirement.prompt-builder.js';
import { basicTools } from './tools/basic.tools.js';

const REQUIREMENT_EXAMPLE_INPUT = '用户注册时必须绑定手机号，密码至少8位';
const MAX_TOOL_ROUNDS = 5;

@Injectable()
export class LlmService {
  private readonly requirementPrompt = buildRequirementPrompt();

  private async buildToolMessages(input: string) {
    if (typeof input !== 'string') {
      throw new BadRequestException('input must be a string');
    }
    const messages = await this.requirementPrompt.formatMessages({ input });
    messages.splice(
      1,
      0,
      new SystemMessage(
        '在需求抽取过程中，按需调用 check_constraint_validity 检查约束，调用 lookup_entity_definition 理解实体。' +
          '检查约束时 input 参数必须使用完整原始需求。工具返回错误时修正参数或依据原文完成抽取，不要反复重复失败调用。' +
          '工具定义仅作参考，不得增加原文不存在的信息。最终输出 JSON，格式为 {"requirements":[{"action":"动作","constraints":[],"entities":[]}]}。',
      ),
    );
    return messages;
  }

  async toolBind(input: string = REQUIREMENT_EXAMPLE_INPUT) {
    const messages = await this.buildToolMessages(input);
    const result = await createChatModel()
      .bindTools(basicTools)
      .invoke(messages);
    return { content: result.content, tool_calls: result.tool_calls ?? [] };
  }

  async toolLoop(input: string = REQUIREMENT_EXAMPLE_INPUT) {
    const messages = await this.buildToolMessages(input);
    const model = createChatModel().bindTools(basicTools);

    // Allow a final model response after the last permitted tool execution.
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await model.invoke(messages);
      if (result.invalid_tool_calls?.length) {
        throw new BadGatewayException('Model returned invalid tool calls');
      }
      const calls = result.tool_calls ?? [];
      if (calls.length === 0) return { content: result.content };
      if (round === MAX_TOOL_ROUNDS) {
        throw new BadGatewayException('Tool loop exceeded maximum rounds');
      }
      if (calls.some((call) => !call.id)) {
        throw new BadGatewayException('Model tool call is missing an ID');
      }
      messages.push(result);
      for (const call of calls) {
        const selectedTool = basicTools.find(
          (entry) => entry.name === call.name,
        );
        let content: string;
        let status: 'success' | 'error' = 'success';
        try {
          if (!selectedTool) throw new Error(`Unknown tool: ${call.name}`);
          // Ground checks in the request, never in model-generated source text.
          const args =
            call.name === 'check_constraint_validity'
              ? { ...call.args, input }
              : call.args;
          content = await selectedTool.invoke(args);
        } catch (error) {
          status = 'error';
          content = JSON.stringify({
            error:
              error instanceof Error ? error.message : 'Tool execution failed',
          });
        }
        messages.push(
          new ToolMessage({
            content,
            tool_call_id: call.id!,
            name: call.name,
            status,
          }),
        );
      }
    }
    throw new BadGatewayException('Tool loop exceeded maximum rounds');
  }

  async chainInvoke(input: string = REQUIREMENT_EXAMPLE_INPUT) {
    const { requirementChain } = await import('./requirement.chain.js');
    return requirementChain.invoke({ input });
  }

  async *chainStream(
    input: string = REQUIREMENT_EXAMPLE_INPUT,
    signal?: AbortSignal,
  ) {
    const { requirementChain } = await import('./requirement.chain.js');
    const chunks = await requirementChain.stream({ input }, { signal });
    yield* chunks;
  }

  async chainBatch(inputs: string[] = [REQUIREMENT_EXAMPLE_INPUT]) {
    const { requirementChain } = await import('./requirement.chain.js');
    return requirementChain.batch(
      inputs.map((input, i) => ({ index: i + 1, input })),
    );
  }

  async promptPreview(input: string = REQUIREMENT_EXAMPLE_INPUT) {
    const promptValue = await this.requirementPrompt.invoke({
      input,
    });
    return {
      rendered: promptValue.toString(),
    };
  }

  async promptToModel(input: string = REQUIREMENT_EXAMPLE_INPUT) {
    const messages = await this.requirementPrompt.formatMessages({
      input,
    });
    const result = await createChatModel().invoke(messages);
    return { content: result.content };
  }

  async invoke(input: string = '') {
    const messages = await this.requirementPrompt.formatMessages({ input });
    const result = await createChatModel().invoke(messages);
    return { content: result.content };
  }

  async *stream(input: string = '', signal?: AbortSignal) {
    const messages = await this.requirementPrompt.formatMessages({ input });
    const chunks = await createChatModel().stream(messages, {
      signal,
    });
    for await (const chunk of chunks) yield { content: chunk.content };
  }

  async batch(inputs: string[]) {
    const messages = await Promise.all(
      inputs.map((input) => this.requirementPrompt.formatMessages({ input })),
    );
    const results = await createChatModel().batch(messages);
    return results.map((result) => ({ content: result.content }));
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  OrchestratorService,
  type OrchestrationResult,
} from './agents/orchestrator.service.js';
import { FilesystemService } from './filesystem/filesystem.service.js';
import { RunnableMemoryService } from './memory/runnable-memory.service.js';

export type AdvancedAnalysisResult = OrchestrationResult & {
  reportPath?: string;
};

@Injectable()
export class AdvancedAnalysisService {
  constructor(
    @Inject(OrchestratorService)
    private readonly orchestrator: OrchestratorService,
    @Inject(RunnableMemoryService)
    private readonly memory: RunnableMemoryService,
    @Inject(FilesystemService) private readonly filesystem: FilesystemService,
  ) {}

  async analyze(
    sessionId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    for (const [name, value] of Object.entries({ sessionId, input })) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new BadRequestException(`${name} must be a non-empty string`);
      }
    }
    const history = await this.memory.getHistory(sessionId);
    const context = JSON.stringify({
      history: history.map((message) => ({
        role: message.getType(),
        content: message.content,
      })),
      input,
    });
    const result = await this.orchestrator.orchestrate(
      '结合以下会话历史和当前请求分析需求完整性。历史中的 human 是用户提供的信息，ai 是助手回复，不能将助手建议当作用户已确认的需求。\n' +
        context,
    );
    if (result.status !== 'completed') return result;
    // Persist the exact final report; neither saving nor recording invokes a model.
    if (!result.report?.trim())
      throw new Error('Completed analysis has no report');
    const reportPath = await this.filesystem.writeReport(result.report);
    await this.memory.appendMessage(sessionId, input, result.report);
    return { ...result, reportPath };
  }
}

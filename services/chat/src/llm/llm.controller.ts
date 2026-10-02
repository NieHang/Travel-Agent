import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LlmService } from './llm.service.js';
import { RequirementService } from './requirement.service.js';

@Controller('api/langchain')
export class LlmController {
  constructor(
    @Inject(LlmService) private readonly llmService: LlmService,
    @Inject(RequirementService)
    private readonly requirementService: RequirementService,
  ) {}

  @Post('structured')
  structured(@Body() body: { input: string }) {
    return this.requirementService.extract(body.input);
  }

  @Post('tool-bind')
  toolBind(@Body() body: { input?: string } = {}) {
    return this.llmService.toolBind(body.input);
  }

  @Post('tool-loop')
  toolLoop(@Body() body: { input?: string } = {}) {
    return this.llmService.toolLoop(body.input);
  }

  @Post('chain-invoke')
  chainInvoke(@Body() body: { input: string }) {
    return this.llmService.chainInvoke(body.input);
  }

  @Post('chain-stream')
  chainStream(@Body() body: { input: string }, @Res() response: Response) {
    return this.sendStream(response, (signal) =>
      this.llmService.chainStream(body.input, signal),
    );
  }

  @Post('chain-batch')
  chainBatch(@Body() body: { inputs: string[] }) {
    return this.llmService.chainBatch(body.inputs);
  }

  @Post('prompt-preview')
  promptPreview(@Body() body: { input: string }) {
    return this.llmService.promptPreview(body.input);
  }

  @Post('prompt-to-model')
  promptToModel(@Body() body: { input: string }) {
    return this.llmService.promptToModel(body.input);
  }

  @Post('invoke')
  invoke(@Body() body: { input: string }) {
    return this.llmService.invoke(body.input);
  }

  @Post('stream')
  async stream(@Body() body: { input: string }, @Res() response: Response) {
    return this.sendStream(response, (signal) =>
      this.llmService.stream(body.input, signal),
    );
  }

  private async sendStream(
    response: Response,
    stream: (signal: AbortSignal) => AsyncIterable<unknown>,
  ) {
    const abort = new AbortController();
    const onClose = () => abort.abort();
    response.on('close', onClose);
    try {
      for await (const chunk of stream(abort.signal)) {
        if (abort.signal.aborted) break;
        if (!response.headersSent) {
          response.status(200);
          response.setHeader('Content-Type', 'text/event-stream');
          response.setHeader('Cache-Control', 'no-cache');
          response.setHeader('Connection', 'keep-alive');
          response.flushHeaders();
        }
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!abort.signal.aborted) {
        // An empty upstream stream still has an SSE completion response.
        if (!response.headersSent) {
          response.status(200);
          response.setHeader('Content-Type', 'text/event-stream');
          response.setHeader('Cache-Control', 'no-cache');
        }
        response.end('data: [DONE]\n\n');
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      if (!response.headersSent) throw error;
      response.end(
        `event: error\ndata: ${JSON.stringify({ message: 'Model stream failed' })}\n\n`,
      );
    } finally {
      response.off('close', onClose);
    }
  }

  @Post('batch')
  batch(@Body() body: { inputs: string[] }) {
    return this.llmService.batch(body.inputs);
  }
}

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import { createLogger } from '../../observability/logger.js';
import {
  llmCallDuration,
  llmCost,
  llmTokens,
} from '../../observability/metrics.js';
import {
  getLlmTotals,
  type LlmTotals,
} from '../../observability/trace-context.js';
import { costFromUsage, estimateCost } from './cost-tracker.js';

export interface LlmCallRecord {
  model: string;
  operation: string;
  status: 'ok' | 'error' | 'aborted';
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  usageSource: 'provider' | 'estimate';
}

interface RunEntry {
  startedAt: number;
  model: string;
  inputTexts: string[];
  toolSchemas: unknown[];
  totals: LlmTotals | undefined;
}

const logger = createLogger('llm');

export class LlmMeteringHandler extends BaseCallbackHandler {
  name = 'llm-metering';
  awaitHandlers = true;
  private readonly operation: string;
  private readonly runs = new Map<string, RunEntry>();

  constructor({ operation = 'other' }: { operation?: string } = {}) {
    super();
    this.operation = operation;
  }

  handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    const params = extraParams?.invocation_params;
    const invocation =
      params !== null && typeof params === 'object' ? params : undefined;
    const model =
      typeof metadata?.ls_model_name === 'string'
        ? metadata.ls_model_name
        : invocation &&
            'model' in invocation &&
            typeof invocation.model === 'string'
          ? invocation.model
          : 'unknown';
    const totals = getLlmTotals();
    totals?.beginCall();
    this.runs.set(runId, {
      startedAt: performance.now(),
      model,
      inputTexts: (messages[0] ?? []).map((message) => message.text),
      toolSchemas:
        invocation && 'tools' in invocation && Array.isArray(invocation.tools)
          ? invocation.tools
          : [],
      totals,
    });
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    this.runs.delete(runId);
    const generation = output.generations[0]?.[0];
    const candidate =
      generation && 'message' in generation ? generation.message : undefined;
    const message =
      AIMessage.isInstance(candidate) || AIMessageChunk.isInstance(candidate)
        ? candidate
        : undefined;
    const usage = message?.usage_metadata;
    if (usage && usage.input_tokens + usage.output_tokens > 0) {
      const tokens = {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_token_details?.cache_read ?? 0,
        outputTokens: usage.output_tokens,
      };
      this.record(entry, {
        ...tokens,
        model: entry.model,
        operation: this.operation,
        status: 'ok',
        durationMs: performance.now() - entry.startedAt,
        costUsd: costFromUsage({ model: entry.model, ...tokens }),
        usageSource: 'provider',
      });
      return;
    }
    const estimate = estimateCost({
      model: entry.model,
      messages: entry.inputTexts,
      toolSchemas: entry.toolSchemas,
      output:
        (message?.text ?? generation?.text ?? '') +
        (message?.tool_calls?.length ? JSON.stringify(message.tool_calls) : ''),
    });
    this.record(entry, {
      model: entry.model,
      operation: this.operation,
      status: 'ok',
      durationMs: performance.now() - entry.startedAt,
      inputTokens: estimate.inputTokens,
      cachedInputTokens: 0,
      outputTokens: estimate.outputTokens,
      costUsd: estimate.cost,
      usageSource: 'estimate',
    });
  }

  handleLLMError(err: Error, runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    this.runs.delete(runId);
    // Providers do not return usage on failure; input may already have been billed.
    const estimate = estimateCost({
      model: entry.model,
      messages: entry.inputTexts,
      toolSchemas: entry.toolSchemas,
    });
    this.record(
      entry,
      {
        model: entry.model,
        operation: this.operation,
        // LangChain's completion stream also reports cancellation as Error('AbortError').
        status:
          err.name === 'AbortError' || err.message === 'AbortError'
            ? 'aborted'
            : 'error',
        durationMs: performance.now() - entry.startedAt,
        inputTokens: estimate.inputTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: estimate.cost,
        usageSource: 'estimate',
      },
      err,
    );
  }

  private record(entry: RunEntry, rec: LlmCallRecord, err?: Error): void {
    try {
      const fields =
        rec.status === 'ok'
          ? rec
          : { ...rec, err: { name: err?.name, message: err?.message } };
      logger[rec.status === 'ok' ? 'info' : 'warn'](fields, 'llm call');
      const labels = { model: rec.model, operation: rec.operation };
      llmCallDuration.observe(
        { ...labels, status: rec.status },
        rec.durationMs / 1000,
      );
      const usageLabels = { ...labels, source: rec.usageSource };
      llmTokens.inc(
        { ...usageLabels, kind: 'input' },
        rec.inputTokens - rec.cachedInputTokens,
      );
      llmTokens.inc(
        { ...usageLabels, kind: 'cached_input' },
        rec.cachedInputTokens,
      );
      llmTokens.inc({ ...usageLabels, kind: 'output' }, rec.outputTokens);
      llmCost.inc(usageLabels, rec.costUsd);
      entry.totals?.add(rec);
    } catch {
      try {
        logger.warn('llm metering failed');
      } catch {
        // Even a broken log sink must not fail the model call.
      }
    } finally {
      entry.totals?.endCall();
    }
  }
}

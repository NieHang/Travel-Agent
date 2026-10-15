import { Logger } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { errorName } from '../common/error-name.js';
import { estimateMessageTokens, KEEP_RECENT_MESSAGES, maybeCompact as compactMessages } from './compact.js';

/**
 * The messages one conversation sends to the model, kept across turns. Once they pass
 * COMPACT_THRESHOLD, maybeCompact replaces the old ones with a summary message for good.
 */
export class ContextManager {
  private readonly logger = new Logger(ContextManager.name);
  private messages: BaseMessage[];

  constructor(messages: BaseMessage[] = []) {
    this.messages = [...messages];
  }

  getMessages(): BaseMessage[] {
    return [...this.messages];
  }

  getEstimatedTokens(): number {
    return estimateMessageTokens(this.messages);
  }

  addMessage(message: BaseMessage): void {
    this.messages.push(message);
  }

  /**
   * Replaces everything but the last KEEP_RECENT_MESSAGES with one summary message once the
   * messages pass COMPACT_THRESHOLD. If summarizing fails, keeps only the most recent messages.
   */
  async maybeCompact(signal?: AbortSignal): Promise<boolean> {
    const before = this.getEstimatedTokens();
    try {
      if (!(await compactMessages(this.messages, signal))) return false;
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logger.warn(`Compaction failed (${errorName(error)}); keeping the last ${KEEP_RECENT_MESSAGES * 2} messages`);
      this.messages = this.messages.slice(-KEEP_RECENT_MESSAGES * 2);
      return false;
    }
    this.logger.log(`Compacted ~${before} → ~${this.getEstimatedTokens()} tokens`);
    return true;
  }
}

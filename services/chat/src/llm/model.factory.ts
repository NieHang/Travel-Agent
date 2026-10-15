import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { InteropZodType } from '@langchain/core/utils/types';
import { ChatOpenAI } from '@langchain/openai';
import { fetch, ProxyAgent } from 'undici';
import {
  getApiKeys,
  loadLangChainConfig,
} from '../config/load-langchain-config.js';

/** A chat model that can bind tools; every supported provider's model is one. */
export type ChatModel = BaseChatModel & Required<Pick<BaseChatModel, 'bindTools'>>;

// Reuse connection pools across invoke, stream, and batch requests.
const proxyAgents = new Map<string, ProxyAgent>();

/** Fetch options that route the provider SDK through HTTPS_PROXY / HTTP_PROXY, if set. */
function proxyFetchOptions() {
  const proxyUrl =
    process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
  if (!proxyUrl) return {};
  let dispatcher = proxyAgents.get(proxyUrl);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, dispatcher);
  }
  return {
    // Undici's Fetch types differ from the SDKs' Web Fetch types.
    fetch: fetch as unknown as typeof globalThis.fetch,
    fetchOptions: { dispatcher },
  };
}

/** `model` overrides the model from config/langchain.yaml, e.g. a cheaper one for side tasks. */
export function createChatModel(options: { model?: string } = {}): ChatModel {
  const { llm } = loadLangChainConfig();
  const keys = getApiKeys();
  const model = options.model ?? llm.model;
  switch (llm.provider) {
    case 'openai':
      if (!keys.openaiApiKey?.trim()) throw new Error('OPENAI_API_KEY is required');
      if (!keys.openaiBaseUrl?.trim()) throw new Error('OPENAI_BASE_URL is required');
      return new ChatOpenAI({
        model,
        temperature: llm.temperature,
        maxTokens: llm.maxTokens,
        apiKey: keys.openaiApiKey,
        configuration: { baseURL: keys.openaiBaseUrl, ...proxyFetchOptions() },
      });
    case 'anthropic': {
      if (!keys.claudeApiKey?.trim()) throw new Error('CLAUDE_API_KEY is required');
      // The Anthropic SDK appends /v1 itself, so accept an OpenAI-style base URL ending in /v1 too.
      const baseUrl = keys.claudeBaseUrl?.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
      return new ChatAnthropic({
        model,
        temperature: llm.temperature,
        maxTokens: llm.maxTokens,
        apiKey: keys.claudeApiKey,
        ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
        clientOptions: proxyFetchOptions(),
      });
    }
    default:
      throw new Error(`Unsupported LLM provider: ${llm.provider}`);
  }
}

/**
 * The configured model, returning output that matches `schema`. OpenAI uses strict function
 * calling. Claude uses structured outputs: its strict tools reject keywords such as maxItems and
 * maxLength, and newer Claude models reject forced tool calls. LangChain strips the unsupported
 * keywords from the schema it sends and validates the reply against the full schema.
 */
export function createStructuredModel<T extends Record<string, unknown>>(
  schema: InteropZodType<T>,
  name: string,
) {
  const model = createChatModel();
  return model instanceof ChatAnthropic
    ? model.withStructuredOutput<T>(schema, { name, method: 'jsonSchema' })
    : model.withStructuredOutput<T>(schema, { name, method: 'functionCalling', strict: true });
}

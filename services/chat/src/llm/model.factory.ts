import { ChatOpenAI } from '@langchain/openai';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { fetch, ProxyAgent } from 'undici';
import { LlmMeteringHandler } from './cost/llm-metering.js';
import {
  loadLangChainConfig,
  PROVIDER_ENV,
} from '../config/load-langchain-config.js';

// Reuse connection pools across invoke, stream, and batch requests.
const proxyAgents = new Map<string, ProxyAgent>();

/** `model` overrides the model from config/langchain.yaml, e.g. a cheaper one for side tasks. */
export function createChatModel(options: { model?: string; operation?: string; callbacks?: BaseCallbackHandler[] } = {}): ChatOpenAI {
  const { llm } = loadLangChainConfig();
  if (!Object.hasOwn(PROVIDER_ENV, llm.provider))
    throw new Error(`Unsupported LLM provider: ${llm.provider}`);
  const env = PROVIDER_ENV[llm.provider as keyof typeof PROVIDER_ENV];
  const apiKey = process.env[env.apiKey];
  const baseURL = process.env[env.baseUrl];
  if (!apiKey?.trim()) throw new Error(`${env.apiKey} is required`);
  if (!baseURL?.trim()) throw new Error(`${env.baseUrl} is required`);
  const proxyUrl =
    process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
  let dispatcher: ProxyAgent | undefined;
  if (proxyUrl) {
    dispatcher = proxyAgents.get(proxyUrl);
    if (!dispatcher) {
      dispatcher = new ProxyAgent(proxyUrl);
      proxyAgents.set(proxyUrl, dispatcher);
    }
  }
  return new ChatOpenAI({
    callbacks: [new LlmMeteringHandler({ operation: options.operation }), ...(options.callbacks ?? [])],
    model: options.model ?? llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    ...(llm.thinking === false ? { modelKwargs: { thinking: { type: 'disabled' } } } : {}),
    apiKey,
    configuration: {
      baseURL,
      ...(dispatcher
        ? {
            // Undici's Fetch types differ from the SDK's Web Fetch types.
            fetch: fetch as unknown as typeof globalThis.fetch,
            fetchOptions: { dispatcher },
          }
        : {}),
    },
  });
}

import { ChatOpenAI } from '@langchain/openai';
import { fetch, ProxyAgent } from 'undici';
import {
  getApiKeys,
  loadLangChainConfig,
} from '../config/load-langchain-config.js';

// Reuse connection pools across invoke, stream, and batch requests.
const proxyAgents = new Map<string, ProxyAgent>();

/** `model` overrides the model from config/langchain.yaml, e.g. a cheaper one for side tasks. */
export function createChatModel(options: { model?: string } = {}): ChatOpenAI {
  const { llm } = loadLangChainConfig();
  const { openaiApiKey, openaiBaseUrl } = getApiKeys();
  if (llm.provider !== 'openai')
    throw new Error(`Unsupported LLM provider: ${llm.provider}`);
  if (!openaiApiKey?.trim()) throw new Error('OPENAI_API_KEY is required');
  if (!openaiBaseUrl?.trim()) throw new Error('OPENAI_BASE_URL is required');
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
    model: options.model ?? llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    apiKey: openaiApiKey,
    configuration: {
      baseURL: openaiBaseUrl,
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

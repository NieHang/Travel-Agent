import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

export type LangChainConfig = {
  llm: {
    provider: string;
    model: string;
    /** Model for conversation summaries; defaults to `model`. */
    compactModel?: string;
    /** false asks DeepSeek-style APIs to skip thinking; unset sends nothing. */
    thinking?: boolean;
    temperature: number;
    maxTokens?: number;
  };
  retrieval: { enabled: boolean; topK: number };
  tools: { enableConstraintCheck: boolean; enableEntityLookup: boolean };
  features: { enableStructuredOutput: boolean; enableStreaming: boolean };
};

export function loadLangChainConfig(): LangChainConfig {
  // Works from both src/config and dist/config.
  const raw = readFileSync(
    new URL('../../config/langchain.yaml', import.meta.url),
    'utf8',
  );
  const config = load(raw) as LangChainConfig | undefined;
  if (
    !config?.llm ||
    typeof config.llm.model !== 'string' ||
    !config.llm.model.trim() ||
    !Number.isFinite(config.llm.temperature) ||
    (config.llm.maxTokens !== undefined &&
      (!Number.isInteger(config.llm.maxTokens) || config.llm.maxTokens <= 0)) ||
    (config.llm.compactModel !== undefined &&
      (typeof config.llm.compactModel !== 'string' || !config.llm.compactModel.trim())) ||
    (config.llm.thinking !== undefined && typeof config.llm.thinking !== 'boolean')
  ) {
    throw new Error('Invalid llm parameters in config/langchain.yaml');
  }
  return config;
}

/** Env vars holding each provider's API key and base URL. */
export const PROVIDER_ENV = {
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  deepseek: { apiKey: 'Deepseek_API_KEY', baseUrl: 'Deepseek_BASE_URL' },
} as const;

export function getApiKeys() {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    embeddingApiKey: process.env.EMBEDDING_API_KEY,
    vectorDbUrl: process.env.VECTOR_DB_URL,
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY,
  };
}

export const getAPIKeys = getApiKeys;

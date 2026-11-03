import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const file = process.env.LANGCHAIN_CONFIG || 'config/langchain.yaml';
  const path = resolve(fileURLToPath(new URL('../../', import.meta.url)), file);
  const raw = readFileSync(path, 'utf8');
  const config = load(raw, { filename: file }) as LangChainConfig | undefined;
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
    throw new Error(`Invalid llm parameters in ${file}`);
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

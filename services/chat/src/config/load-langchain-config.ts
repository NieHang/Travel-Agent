import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

export type LangChainConfig = {
  llm: {
    provider: string;
    model: string;
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
      (!Number.isInteger(config.llm.maxTokens) || config.llm.maxTokens <= 0))
  ) {
    throw new Error('Invalid llm parameters in config/langchain.yaml');
  }
  return config;
}

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

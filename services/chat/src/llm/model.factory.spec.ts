import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

const config = vi.hoisted(() => ({ llm: {} as Record<string, unknown> }));
vi.mock('../config/load-langchain-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/load-langchain-config.js')>()),
  loadLangChainConfig: () => config,
}));

import { createChatModel, createStructuredModel } from './model.factory.js';

describe('createChatModel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('openai', () => {
    beforeEach(() => {
      config.llm = { provider: 'openai', model: 'gpt-5.4', temperature: 0, maxTokens: 4096 };
    });

    it('requires an API key from the environment', () => {
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:1234/v1');
      expect(() => createChatModel()).toThrow('OPENAI_API_KEY is required');
    });

    it('requires a base URL from the environment', () => {
      vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
      vi.stubEnv('OPENAI_BASE_URL', '');
      expect(() => createChatModel()).toThrow('OPENAI_BASE_URL is required');
    });

    it('uses the configured model unless the caller picks another', () => {
      vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
      vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:1234/v1');
      expect((createChatModel() as ChatOpenAI).model).toBe('gpt-5.4');
      expect((createChatModel({ model: 'gpt-5.4-mini' }) as ChatOpenAI).model).toBe('gpt-5.4-mini');
    });

    it('returns structured output through strict function calling', () => {
      vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
      vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:1234/v1');
      const spy = vi.spyOn(ChatOpenAI.prototype, 'withStructuredOutput');
      const schema = z.object({ tags: z.array(z.string()).max(5) });
      createStructuredModel(schema, 'tagging');
      expect(spy).toHaveBeenCalledWith(schema, { name: 'tagging', method: 'functionCalling', strict: true });
    });
  });

  describe('anthropic', () => {
    beforeEach(() => {
      config.llm = { provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 16000 };
      vi.stubEnv('CLAUDE_BASE_URL', '');
    });

    it('requires an API key from the environment', () => {
      vi.stubEnv('CLAUDE_API_KEY', '');
      expect(() => createChatModel()).toThrow('CLAUDE_API_KEY is required');
    });

    it('builds a Claude model that sends no sampling parameters', () => {
      vi.stubEnv('CLAUDE_API_KEY', 'local-test-key');
      const model = createChatModel();
      expect(model).toBeInstanceOf(ChatAnthropic);
      const params = (model as ChatAnthropic).invocationParams({});
      expect(params).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16000 });
      expect(params).not.toHaveProperty('temperature');
      expect((createChatModel({ model: 'claude-sonnet-5-5' }) as ChatAnthropic).model).toBe('claude-sonnet-5-5');
    });

    it('drops a trailing /v1 from CLAUDE_BASE_URL, because the SDK adds it', () => {
      vi.stubEnv('CLAUDE_API_KEY', 'local-test-key');
      vi.stubEnv('CLAUDE_BASE_URL', 'https://relay.example.com/v1/');
      expect((createChatModel() as ChatAnthropic).apiUrl).toBe('https://relay.example.com');
    });

    it('returns structured output through structured outputs, not strict tools', () => {
      vi.stubEnv('CLAUDE_API_KEY', 'local-test-key');
      const spy = vi.spyOn(ChatAnthropic.prototype, 'withStructuredOutput');
      const schema = z.object({ tags: z.array(z.string()).max(5) });
      createStructuredModel(schema, 'tagging');
      expect(spy).toHaveBeenCalledWith(schema, { name: 'tagging', method: 'jsonSchema' });
    });
  });

  it('rejects an unknown provider', () => {
    config.llm = { provider: 'other', model: 'x' };
    expect(() => createChatModel()).toThrow('Unsupported LLM provider: other');
  });
});

import { createChatModel } from './model.factory.js';
import { LlmMeteringHandler } from './cost/llm-metering.js';

describe('createChatModel', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('attaches metering to every model, including operation-tagged calls', () => {
    vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:1234/v1');
    const model = createChatModel({ operation: 'trip.classify' });
    expect(model.callbacks).toEqual([expect.any(LlmMeteringHandler)]);
    expect(createChatModel().callbacks).toEqual([expect.any(LlmMeteringHandler)]);
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
    expect(createChatModel().model).toBe('deepseek-flash');
    expect(createChatModel({ model: 'deepseek-v4-pro' }).model).toBe('deepseek-v4-pro');
  });

  it('turns off thinking when the config says thinking: false', () => {
    vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:1234/v1');
    expect(createChatModel().modelKwargs).toEqual({ thinking: { type: 'disabled' } });
  });

  it('reads Deepseek_API_KEY and Deepseek_BASE_URL for the deepseek provider', () => {
    vi.stubEnv('TEST_LLM_PROVIDER', 'deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('OPENAI_BASE_URL', 'http://openai.test/v1');
    vi.stubEnv('Deepseek_API_KEY', '');
    vi.stubEnv('Deepseek_BASE_URL', 'http://deepseek.test/beta');
    expect(() => createChatModel()).toThrow('Deepseek_API_KEY is required');
    vi.stubEnv('Deepseek_API_KEY', 'deepseek-key');
    const model = createChatModel();
    expect(model.apiKey).toBe('deepseek-key');
    expect(model.clientConfig.baseURL).toBe('http://deepseek.test/beta');
  });

  it('rejects an unknown provider', () => {
    vi.stubEnv('TEST_LLM_PROVIDER', 'acme');
    expect(() => createChatModel()).toThrow('Unsupported LLM provider: acme');
  });
});

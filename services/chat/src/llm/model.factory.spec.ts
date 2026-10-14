import { createChatModel } from './model.factory.js';

describe('createChatModel', () => {
  afterEach(() => vi.unstubAllEnvs());

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
    expect(createChatModel().model).toBe('gpt-5.4');
    expect(createChatModel({ model: 'gpt-5.4-mini' }).model).toBe('gpt-5.4-mini');
  });
});

// The LangChain unit tests fake an OpenAI-compatible server, so pin them to the OpenAI settings
// they were written for, whichever provider config/langchain.yaml selects. A spec can still
// vi.mock this module itself to test other settings.
vi.mock('../src/config/load-langchain-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/load-langchain-config.js')>();
  return {
    ...actual,
    loadLangChainConfig: () => ({
      ...actual.loadLangChainConfig(),
      llm: { provider: 'openai', model: 'gpt-5.4', compactModel: 'gpt-5.4-mini', temperature: 0, maxTokens: 4096 },
    }),
  };
});

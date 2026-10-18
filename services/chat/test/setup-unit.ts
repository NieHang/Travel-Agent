// Unit tests fake an OpenAI-compatible server through OPENAI_API_KEY / OPENAI_BASE_URL, so pin the
// provider to openai instead of reading it from config/langchain.yaml. Other settings stay real.
vi.mock('../src/config/load-langchain-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/load-langchain-config.js')>();
  return {
    ...actual,
    loadLangChainConfig: () => {
      const config = actual.loadLangChainConfig();
      return { ...config, llm: { ...config.llm, provider: process.env.TEST_LLM_PROVIDER ?? 'openai' } };
    },
  };
});

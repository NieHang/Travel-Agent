/** The SDK only reports "Unable to connect", so check the configured endpoint first. */
export async function requireLangfuse(): Promise<void> {
  const base = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000';
  const url = new URL('/api/public/health', base);
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (response?.ok) return;
  const localHint = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? ' Start the local Langfuse instance with `docker compose up -d` in the langfuse folder (see evals/README.md).'
    : '';
  throw new Error(`Langfuse health check failed at ${url.href}${response ? ` (HTTP ${response.status})` : ''}. `
    + 'Check LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in services/chat/.env.eval.' + localHint);
}

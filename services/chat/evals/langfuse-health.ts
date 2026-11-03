/** The SDK only reports "Unable to connect" when local Langfuse is down; fail first with the fix. */
export async function requireLangfuse(): Promise<void> {
  const base = process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000';
  const response = await fetch(new URL('/api/public/health', base), { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (response?.ok) return;
  throw new Error(`Langfuse is not reachable at ${base}${response ? ` (HTTP ${response.status})` : ''}. `
    + 'Is Docker running? Start it, then run `docker compose up -d` in the langfuse folder (see evals/README.md).');
}

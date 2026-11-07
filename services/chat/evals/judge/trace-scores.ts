import type { LangfuseClient } from '@langfuse/client';
import type { Score } from '../schemas.js';

/**
 * Writes `scores` onto a trace as the only scores it holds whose names `owns` accepts. Langfuse overwrites a score
 * only when both id and timestamp match, so a re-import reuses the earlier timestamps, and an owned score the new
 * set no longer has (a criterion now n/a) is deleted.
 */
export async function replaceTraceScores(client: LangfuseClient, label: string, traceId: string, scores: Score[], owns: (name: string) => boolean, metadata: Record<string, string>) {
  const { data } = await client.api.scores.getMany({ traceId, limit: 100 });
  const earlier = new Map(data.filter((s) => owns(s.name)).map((s) => [s.id, s.timestamp]));
  const body = scores.map((score) => {
    const id = `${traceId}-${score.name}`;
    return { id, timestamp: earlier.get(id), traceId, ...score, dataType: 'NUMERIC' as const, metadata };
  });
  // The batch endpoint, not the queued score.create: that queue drops every score added during an automatic 10-score flush.
  const response = await client.api.scores.create(body);
  if ('rejected' in response && response.rejected) throw new Error(`${label}: Langfuse rejected ${response.rejected} scores: ${response.errors.map((e) => e.message).join('; ')}`);
  for (const id of earlier.keys()) if (!body.some((s) => s.id === id)) await client.api.scores.delete(id);
}

import type { Message, TripSnapshot } from '@autix/contracts'
export function latestTripSnapshot(messages: Message[]): TripSnapshot | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].metadata && 'trip' in messages[i].metadata!)
      return messages[i].metadata!.trip ?? null
  }
  return null
}

import { z } from 'zod';
import {
  MessageMetadataSchema,
  TripSnapshotSchema,
  aiUIResponseSchema,
  uiIntentSchema,
  type TripSnapshot,
  type SendMessageRequest,
} from '@autix/contracts';
import type { AIUIResponse, UIFlowContext } from './ui-types.js';

export const UIFlowSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  context: z.object({
    stage: z.enum([
      'idle',
      'choosing_trip_type',
      'collecting_requirements',
      'reviewing_itinerary',
      'awaiting_confirmation',
      'confirmed',
    ]),
    requirements: z.record(
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    ),
    itinerary: z.string().nullable(),
    query: z.object({ intent: uiIntentSchema, input: z.string() }).nullable(),
    editingRequirements: z.boolean().optional(),
    replyLanguage: z.string().optional(),
    preferredLocale: z.string().optional(),
  }),
  response: aiUIResponseSchema,
  trip: TripSnapshotSchema.nullable(),
});
export type UIFlowSnapshot = z.infer<typeof UIFlowSnapshotSchema>;
export interface PreparedUITurn {
  response: AIUIResponse;
  snapshot: UIFlowSnapshot;
  markdownInput: string | null;
}
export interface TurnStreaming {
  signal: AbortSignal;
  onChunk(content: string): void;
}
export function readUIFlowSnapshot(metadata: unknown): UIFlowSnapshot | null {
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).uiFlowSnapshot
      : null;
  const parsed = UIFlowSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export function toPublicMessageMetadata(metadata: unknown) {
  if (metadata == null) return null;
  const parsed = MessageMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
export function requestContent(
  request: SendMessageRequest,
  snapshot: UIFlowSnapshot | null,
): string {
  if ('content' in request) return request.content;
  const component = snapshot?.response.components.find(
    (c) => c.id === request.action.componentId,
  );
  if (!component) return JSON.stringify(request.action);
  const action = request.action;
  if (component.type === 'selection' && action.type === 'selection')
    return action.values
      .map((v) => component.options.find((o) => o.value === v)?.label ?? v)
      .join(', ');
  if (component.type === 'form' && action.type === 'form_submit')
    return action.values
      .map(
        (v) =>
          `${component.fields.find((f) => f.name === v.name)?.label ?? v.name}: ${v.value ?? ''}`,
      )
      .join('\n');
  if (component.type === 'confirmation' && action.type === 'confirmation')
    return action.confirmed ? component.confirmLabel : component.cancelLabel;
  if (component.type === 'action_buttons' && action.type === 'button_click')
    return (
      component.buttons.find((b) => b.id === action.buttonId)?.label ??
      action.buttonId
    );
  return JSON.stringify(action);
}
export function buildTripSnapshot(
  context: UIFlowContext,
  response: AIUIResponse,
  revision: number,
  previous: TripSnapshot | null,
  days?: TripSnapshot['days'],
): TripSnapshot | null {
  if (
    context.stage === 'idle' &&
    !previous &&
    !['hotel_search', 'flight_search', 'place_details'].includes(
      response.intent,
    )
  )
    return null;
  const r = context.requirements;
  const trip: TripSnapshot = {
    revision,
    status:
      context.stage === 'confirmed'
        ? 'confirmed'
        : context.itinerary
          ? 'draft'
          : context.editingRequirements
            ? 'updating'
            : 'collecting',
    destination: typeof r.destination === 'string' ? r.destination : null,
    departureDate: typeof r.departureDate === 'string' ? r.departureDate : null,
    returnDate: typeof r.returnDate === 'string' ? r.returnDate : null,
    travelers: typeof r.travelers === 'number' ? r.travelers : null,
    budget: typeof r.budget === 'number' ? r.budget : null,
    budgetCurrency:
      typeof r.budgetCurrency === 'string' ? r.budgetCurrency : null,
    itineraryMarkdown: context.itinerary,
    days: context.itinerary ? (days ?? previous?.days ?? []) : [],
    hotels: previous?.hotels ?? [],
    routes: previous?.routes ?? [],
    hotspots: previous?.hotspots ?? [],
  };
  if (response.intent === 'hotel_search')
    trip.hotels = response.components.filter(
      (c) => c.type === 'card' || c.type === 'table',
    );
  if (response.intent === 'flight_search')
    trip.routes = response.components.filter(
      (c) => c.type === 'card' || c.type === 'table',
    );
  if (response.intent === 'place_details')
    trip.hotspots = response.components.filter(
      (c) => c.type === 'card' || c.type === 'table',
    );
  return TripSnapshotSchema.parse(trip);
}

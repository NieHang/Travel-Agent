import type { z } from 'zod';
export type {
  StreamMessage,
  MarkdownPayload,
  UIPayload,
  MetaPayload,
  ProgressPayload,
  ErrorPayload,
  ComponentInteractionState,
} from '@autix/contracts';
import type {
  aiUIResponseSchema,
  uiResponseSchema,
  uiActionSchema,
  uiIntentSchema,
  formFieldSchema,
  uiModelOutputSchema,
  uiSemanticsSchema,
  planningRequirementsSchema,
} from './ui-schemas.js';

export type UIResponse = z.infer<typeof uiResponseSchema>;
export type AIUIResponse = z.infer<typeof aiUIResponseSchema>;
export type UIAction = z.infer<typeof uiActionSchema>;
export type UIIntent = z.infer<typeof uiIntentSchema>;
export type UIFormField = z.infer<typeof formFieldSchema>;
export type UIModelOutput = z.infer<typeof uiModelOutputSchema>;
export type UISemantics = z.infer<typeof uiSemanticsSchema>;
export type PlanningRequirements = z.infer<typeof planningRequirementsSchema>;
export type UIFlowStage =
  | 'idle'
  | 'choosing_trip_type'
  | 'collecting_requirements'
  | 'reviewing_itinerary'
  | 'awaiting_confirmation'
  | 'confirmed';
export interface UIFlowContext {
  stage: UIFlowStage;
  requirements: Record<string, string | number | boolean | null>;
  itinerary: string | null;
  query: { intent: UIIntent; input: string } | null;
  editingRequirements?: boolean;
  replyLanguage?: string;
  preferredLocale?: string;
  /** Trusted server guidance, never accepted from HTTP request bodies. */
  operation?: 'preview_itinerary' | 'query' | 'general';
}

import type {
  AIUIResponse,
  PlanningRequirements,
  UIModelOutput,
  UISemantics,
} from './ui-types.js';

export const emptyRequirements = {
  destination: null,
  tripType: null,
  departureDate: null,
  returnDate: null,
  travelers: null,
  budget: null,
  budgetCurrency: null,
  preferences: null,
};
export function modelOutput(
  response: AIUIResponse,
  requirements: Partial<PlanningRequirements> = {},
  operation: UISemantics['operation'] = response.intent === 'trip_planning'
    ? 'update_requirements'
    : 'answer',
  replyLanguage = 'zh',
): UIModelOutput {
  return {
    semantics: {
      intent: response.intent,
      operation,
      replyLanguage,
      requirements: { ...emptyRequirements, ...requirements },
    },
    response: structuredClone(response),
  };
}

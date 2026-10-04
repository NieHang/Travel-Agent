import { BadRequestException, ConflictException } from '@nestjs/common';
import type { UIAction } from '@autix/contracts';
import type { UIFlowSnapshot } from './ui-session.js';
import { validateForm } from './ui-form.validation.js';
import { mergePlanningRequirements } from './ui-requirements.validation.js';
import type { PlanningRequirements } from './ui-types.js';

/** Pure preflight: reject forged/stale values before persisting a user turn. */
export function validateUIAction(
  snapshot: Pick<UIFlowSnapshot, 'context' | 'response'>,
  action: UIAction,
): void {
  const { context, response } = snapshot;
  const component = response.components.find(
    (c) => c.id === action.componentId,
  );
  if (!component)
    throw new ConflictException('UI component is no longer active');
  switch (action.type) {
    case 'selection':
      if (component.type !== 'selection')
        throw new BadRequestException('Action type mismatch');
      if (
        new Set(action.values).size !== action.values.length ||
        (component.mode === 'single' && action.values.length !== 1) ||
        action.values.some((v) => !component.options.some((o) => o.value === v))
      )
        throw new BadRequestException('Invalid selection');
      if (
        component.purpose === 'trip_type' &&
        (response.intent !== 'trip_planning' ||
          context.stage !== 'choosing_trip_type')
      )
        throw new ConflictException('Selection not allowed in current stage');
      break;
    case 'form_submit': {
      if (component.type !== 'form')
        throw new BadRequestException('Action type mismatch');
      if (
        response.intent === 'trip_planning' &&
        context.stage !== 'collecting_requirements'
      )
        throw new ConflictException('Form not allowed in current stage');
      const submitted = validateForm(
        component,
        action,
        response.intent === 'trip_planning' ? context.requirements : {},
      );
      if (response.intent === 'trip_planning')
        mergePlanningRequirements(
          context.requirements,
          submitted as Partial<PlanningRequirements>,
        );
      break;
    }
    case 'confirmation':
      if (component.type !== 'confirmation')
        throw new BadRequestException('Action type mismatch');
      if (
        context.stage !== 'awaiting_confirmation' ||
        component.summary !== context.itinerary
      )
        throw new ConflictException('No matching route awaiting confirmation');
      break;
    case 'button_click': {
      if (component.type !== 'action_buttons')
        throw new BadRequestException('Action type mismatch');
      const button = component.buttons.find((b) => b.id === action.buttonId);
      if (!button) throw new BadRequestException('Unknown button');
      if (
        button.action === 'confirm_itinerary' &&
        (response.intent !== 'trip_planning' ||
          context.stage !== 'reviewing_itinerary' ||
          !context.itinerary)
      )
        throw new ConflictException('No route to confirm');
      if (
        button.action === 'edit_itinerary' &&
        (response.intent !== 'trip_planning' || !context.itinerary)
      )
        throw new ConflictException('No route to edit');
      if (button.action === 'resume_planning' && context.stage === 'idle')
        throw new ConflictException('No planning draft');
      if (button.action === 'refine_search' && !context.query)
        throw new ConflictException('No active query');
      break;
    }
  }
}

import { getUICopy } from './ui-localization.js';
import type {
  AIUIResponse,
  UIFlowContext,
  UIFormField,
  UIResponse,
} from './ui-types.js';

export function getTripOptions(language?: string) {
  const copy = getUICopy(language);
  return ['business', 'family', 'solo', 'couple'].map((value, i) => ({
    value,
    label: copy.tripLabels[i],
    description: copy.tripDescriptions[i],
  }));
}
export function getPlanningFields(language?: string): UIFormField[] {
  const copy = getUICopy(language);
  return [
    {
      type: 'input',
      name: 'destination',
      label: copy.destination,
      required: true,
      placeholder: copy.destinationPlaceholder,
    },
    {
      type: 'date',
      name: 'departureDate',
      label: copy.departureDate,
      required: true,
      placeholder: null,
    },
    {
      type: 'date',
      name: 'returnDate',
      label: copy.returnDate,
      required: true,
      placeholder: null,
    },
    {
      type: 'number',
      name: 'travelers',
      label: copy.travelers,
      required: true,
      min: 1,
      max: 100,
    },
    {
      type: 'textarea',
      name: 'preferences',
      label: copy.preferences,
      required: false,
      placeholder: copy.preferencesPlaceholder,
    },
  ];
}
export function progress(context: UIFlowContext): UIResponse {
  const copy = getUICopy(context.replyLanguage);
  const stages = [
    'choosing_trip_type',
    'collecting_requirements',
    'reviewing_itinerary',
    'awaiting_confirmation',
  ];
  const index =
    context.stage === 'confirmed'
      ? stages.length
      : Math.max(0, stages.indexOf(context.stage));
  return {
    id: 'steps',
    type: 'steps',
    title: copy.progress,
    items: copy.stages.map((label, i) => ({
      id: stages[i],
      label,
      status: i < index ? 'completed' : i === index ? 'current' : 'pending',
    })),
  };
}
export function planningResponse(context: UIFlowContext): AIUIResponse {
  const copy = getUICopy(context.replyLanguage);
  let components: UIResponse[];
  let message: string;
  if (context.stage === 'choosing_trip_type' || context.stage === 'idle') {
    message = copy.chooseType;
    components = [
      {
        id: 'trip-type',
        type: 'selection',
        purpose: 'trip_type',
        title: copy.tripTypeTitle,
        mode: 'single',
        options: getTripOptions(context.replyLanguage),
      },
    ];
  } else if (context.stage === 'collecting_requirements') {
    message = copy.collect;
    components = [
      {
        id: 'requirements',
        type: 'form',
        title: copy.requirementsTitle,
        fields: getPlanningFields(context.replyLanguage).filter(
          (f) =>
            context.editingRequirements ||
            (f.type === 'date' &&
              (!context.requirements.departureDate || !context.requirements.returnDate)) ||
            context.requirements[f.name] === undefined ||
            context.requirements[f.name] === null ||
            context.requirements[f.name] === '',
        ),
        initialValues: getPlanningFields(context.replyLanguage)
          .filter((f) => context.requirements[f.name] !== undefined)
          .map((f) => ({ name: f.name, value: context.requirements[f.name] })),
        submitLabel: copy.generateDraft,
      },
    ];
  } else if (context.stage === 'awaiting_confirmation') {
    message = copy.awaiting;
    components = [
      {
        id: 'confirmation',
        type: 'confirmation',
        title: copy.confirmationTitle,
        summary: context.itinerary!,
        confirmLabel: copy.confirm,
        cancelLabel: copy.cancel,
      },
    ];
  } else {
    message = context.stage === 'confirmed' ? copy.confirmed : copy.review;
    components = [
      {
        id: 'itinerary',
        type: 'card',
        title:
          context.stage === 'confirmed' ? copy.confirmedTitle : copy.draftTitle,
        category: 'itinerary',
        description: context.itinerary!,
        details: [],
        sourceStatus: 'unverified',
      },
      {
        id: 'planning-actions',
        type: 'action_buttons',
        buttons: [
          ...(context.stage === 'confirmed'
            ? []
            : [
                {
                  id: 'confirm',
                  label: copy.confirm,
                  action: 'confirm_itinerary' as const,
                },
              ]),
          { id: 'edit', label: copy.edit, action: 'edit_itinerary' },
        ],
      },
    ];
  }
  return {
    message,
    intent: 'trip_planning',
    components: [...components, progress(context)],
  };
}

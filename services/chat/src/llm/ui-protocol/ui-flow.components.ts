import type {
  AIUIResponse,
  UIFlowContext,
  UIFormField,
  UIResponse,
} from './ui-types.js';

export const tripOptions = [
  {
    value: 'business',
    label: '商务出差',
    description: '兼顾工作安排与短途游览',
  },
  { value: 'family', label: '亲子游', description: '适合家庭出行的节奏' },
  { value: 'solo', label: '个人游', description: '按个人兴趣安排行程' },
  { value: 'couple', label: '情侣游', description: '适合两人出行' },
];
export const planningFields: UIFormField[] = [
  {
    type: 'input',
    name: 'destination',
    label: '目的地',
    required: true,
    placeholder: '例如日本东京',
  },
  {
    type: 'date',
    name: 'departureDate',
    label: '出发日期',
    required: true,
    placeholder: null,
  },
  {
    type: 'date',
    name: 'returnDate',
    label: '返程日期',
    required: true,
    placeholder: null,
  },
  {
    type: 'number',
    name: 'travelers',
    label: '出行人数',
    required: true,
    min: 1,
    max: 100,
  },
  {
    type: 'number',
    name: 'budget',
    label: '总预算（人民币）',
    required: true,
    min: 0,
    max: null,
  },
  {
    type: 'textarea',
    name: 'preferences',
    label: '兴趣与特殊需求',
    required: false,
    placeholder: '例如美食、自然风景、无障碍设施',
  },
];
export function progress(context: UIFlowContext): UIResponse {
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
    title: '路线规划进度',
    items: ['旅游类型', '旅游需求', '路线预览', '路线确认'].map((label, i) => ({
      id: stages[i],
      label,
      status: i < index ? 'completed' : i === index ? 'current' : 'pending',
    })),
  };
}
export function planningResponse(context: UIFlowContext): AIUIResponse {
  let components: UIResponse[];
  let message: string;
  if (context.stage === 'choosing_trip_type' || context.stage === 'idle') {
    message = '请选择旅游类型。';
    components = [
      {
        id: 'trip-type',
        type: 'selection',
        title: '这次是什么类型的出行？',
        mode: 'single',
        options: tripOptions,
      },
    ];
  } else if (context.stage === 'collecting_requirements') {
    message = '请补充尚未提供的旅游需求。';
    components = [
      {
        id: 'requirements',
        type: 'form',
        title: '旅游需求',
        fields: planningFields.filter(
          (f) =>
            context.editingRequirements ||
            context.requirements[f.name] === undefined ||
            context.requirements[f.name] === null ||
            context.requirements[f.name] === '',
        ),
        submitLabel: '生成路线草案',
      },
    ];
  } else if (context.stage === 'awaiting_confirmation') {
    message = '请确认下面的路线草案。确认只保存路线，不会预订。';
    components = [
      {
        id: 'confirmation',
        type: 'confirmation',
        title: '确认旅游路线',
        summary: context.itinerary!,
        confirmLabel: '确认路线',
        cancelLabel: '返回修改',
      },
    ];
  } else {
    message =
      context.stage === 'confirmed'
        ? '已确认并保存旅游路线。'
        : '请查看路线草案，可确认或修改需求。';
    components = [
      {
        id: 'itinerary',
        type: 'card',
        title: context.stage === 'confirmed' ? '已确认的路线' : '路线草案',
        category: 'itinerary',
        description: context.itinerary!,
        details: [],
        sourceStatus: 'unverified',
      },
    ];
    components.push({
      id: 'planning-actions',
      type: 'action_buttons',
      buttons: [
        ...(context.stage === 'confirmed'
          ? []
          : [
              {
                id: 'confirm',
                label: '确认路线',
                action: 'confirm_itinerary' as const,
              },
            ]),
        { id: 'edit', label: '修改需求', action: 'edit_itinerary' },
      ],
    });
  }
  return {
    message,
    intent: 'trip_planning',
    components: [...components, progress(context)],
  };
}

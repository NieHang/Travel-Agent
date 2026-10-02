import {
  DynamicStructuredTool,
  type ToolSchemaBase,
} from '@langchain/core/tools';

// This local glossary supplies general definitions, not additional requirements.
const entityDefinitions = new Map([
  ['用户', '使用系统并执行注册、登录等操作的主体。'],
  ['手机号', '用于联系用户或验证用户身份的手机号码。'],
  ['密码', '用于验证用户身份的秘密字符串。'],
]);

export const checkConstraintValidity = new DynamicStructuredTool<
  ToolSchemaBase,
  { constraint: string; input: string },
  Record<string, unknown>,
  string
>({
  func: async ({
    constraint,
    input,
  }: {
    constraint: string;
    input: string;
  }) => {
    const text = constraint.trim();
    const explicit = /必须|至少|不得|不能/.test(text);
    const grounded = text.length > 0 && input.includes(text);
    return JSON.stringify({
      constraint: text,
      valid: explicit && grounded,
      reason: !grounded
        ? '约束必须明确出现在原始需求中。'
        : !explicit
          ? '未包含必须、至少、不得或不能等明确约束标记。'
          : '约束出现在原始需求中，且包含明确约束标记。',
    });
  },
  name: 'check_constraint_validity',
  description:
    '检查候选约束是否原文出现且包含明确约束标记。这是文本规则检查，不判断业务可行性或约束间冲突。input 必须是完整原始需求。',
  schema: {
    type: 'object',
    properties: {
      constraint: { type: 'string', description: '从需求原文提取的候选约束' },
      input: { type: 'string', description: '完整原始需求文本' },
    },
    required: ['constraint', 'input'],
    additionalProperties: false,
  },
});

export const lookupEntityDefinition = new DynamicStructuredTool<
  ToolSchemaBase,
  { entity: string },
  Record<string, unknown>,
  string
>({
  func: async ({ entity }: { entity: string }) => {
    const name = entity.trim();
    const definition = entityDefinitions.get(name);
    return JSON.stringify({
      entity: name,
      found: definition !== undefined,
      definition: definition ?? null,
    });
  },
  name: 'lookup_entity_definition',
  description:
    '查询用户、手机号、密码的内置通用定义，未知实体返回未找到。定义仅用于理解实体，不得据此添加原文不存在的需求。',
  schema: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: '需求原文出现的实体名称' },
    },
    required: ['entity'],
    additionalProperties: false,
  },
});

export const basicTools = [checkConstraintValidity, lookupEntityDefinition];

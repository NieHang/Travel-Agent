import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { uiModelOutputSchema } from './ui-schemas.js';

// Zod 3 conversion can reuse schemas via #/properties/... references. Strict
// model tools do not accept those references. Our nonrecursive protocol can
// inline them without changing its constraints or introducing another schema.
const root = toJsonSchema(uiModelOutputSchema);
function expand(value: unknown, resolving = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => expand(item, resolving));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  // Saved form values are trusted workflow state, not model-generated content.
  if (record.properties && typeof record.properties === 'object' &&
      'initialValues' in record.properties) {
    const { initialValues: _initialValues, ...properties } = record.properties as Record<string, unknown>;
    return expand({ ...record, properties });
  }
  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    if (!ref.startsWith('#/') || resolving.has(ref))
      throw new Error('Unsupported UI schema reference');
    let target: unknown = root;
    for (const part of ref.slice(2).split('/')) {
      if (target === null || typeof target !== 'object')
        throw new Error('Unresolved UI schema reference');
      target = (target as Record<string, unknown>)[
        part.replace(/~1/g, '/').replace(/~0/g, '~')
      ];
    }
    if (target === undefined) throw new Error('Unresolved UI schema reference');
    const next = new Set(resolving).add(ref);
    const { $ref: _ref, ...siblings } = record;
    return {
      ...(expand(target, next) as Record<string, unknown>),
      ...(expand(siblings, resolving) as Record<string, unknown>),
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      expand(child, resolving),
    ]),
  );
}
export const uiModelJsonSchema = expand(root) as Record<string, unknown>;

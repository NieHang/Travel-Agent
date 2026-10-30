import type { Classified } from '../../src/trip/commands.js';
import type { ClassifyEntry, Score } from '../schemas.js';

export function gradeClassify(actual: Classified, expected: ClassifyEntry['expected']): Score[] {
  const fields = Object.keys(actual.patch) as (keyof Classified['patch'])[];
  const nullFields = fields.filter((key) => expected.patch[key] == null);
  return [
    { name: 'intent_acc', value: Number(actual.intent === expected.intent) },
    { name: 'patch_exact', value: Number(fields.every((key) => sameValue(key, actual.patch[key], expected.patch[key] ?? null))) },
    ...fields.filter((key) => Object.hasOwn(expected.patch, key)).map((key) => ({
      name: `patch_field_${key}`, value: Number(sameValue(key, actual.patch[key], expected.patch[key] ?? null)),
    })),
    { name: 'patch_hallucination', value: nullFields.length ? nullFields.filter((key) => actual.patch[key] !== null).length / nullFields.length : 0 },
    { name: 'clarify_match', value: Number((actual.clarify?.field ?? null) === expected.clarifyField) },
  ];
}

// Destination and preferences are free text: "京都" vs "京都市" or "安静" vs "喜欢安静" is the same answer.
function sameValue(key: keyof Classified['patch'], actual: unknown, expected: unknown): boolean {
  if (key !== 'destination' && key !== 'preferences') return actual === expected;
  if (typeof actual !== 'string' || typeof expected !== 'string') return actual === expected;
  const [a, b] = [actual, expected].map((text) => text.normalize('NFKC').replace(/\s/gu, '').toLowerCase());
  return a.includes(b) || b.includes(a);
}

export function gradeClarify(items: { expected: ClassifyEntry['expected']['clarifyField']; actual: ClassifyEntry['expected']['clarifyField'] }[]): Score[] {
  const expectedCount = items.filter((item) => item.expected !== null).length;
  const actualCount = items.filter((item) => item.actual !== null).length;
  const correct = items.filter((item) => item.expected !== null && item.actual !== null).length;
  // With no positives, the corresponding ratio is vacuously perfect.
  return [
    { name: 'clarify_recall', value: expectedCount ? correct / expectedCount : 1 },
    { name: 'clarify_precision', value: actualCount ? correct / actualCount : 1 },
  ];
}

import type { Classified } from '../../src/trip/commands.js';
import { gradeClassify, gradeClarify } from './classify.js';

const actual: Classified = {
  intent: 'plan', locale: 'en', clarify: null,
  patch: { destination: 'Kyoto', tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
};

it('scores a sparse exact patch and absent clarification', () => {
  expect(gradeClassify(actual, { intent: 'plan', patch: { destination: 'Kyoto' }, clarifyField: null })).toEqual([
    { name: 'intent_acc', value: 1 }, { name: 'patch_exact', value: 1 },
    { name: 'patch_field_destination', value: 1 }, { name: 'patch_hallucination', value: 0 },
    { name: 'clarify_match', value: 1 },
  ]);
});

it('counts hallucinations only among expected-null fields and distinguishes wrong values', () => {
  expect(gradeClassify({ ...actual, intent: 'chat', patch: { ...actual.patch, destination: 'Osaka', budget: 900 } },
    { intent: 'plan', patch: { destination: 'Kyoto' }, clarifyField: 'destination' })).toEqual([
    { name: 'intent_acc', value: 0 }, { name: 'patch_exact', value: 0 },
    { name: 'patch_field_destination', value: 0 }, { name: 'patch_hallucination', value: 1 / 7 },
    { name: 'clarify_match', value: 0 },
  ]);
});

it('handles explicit null and no expected-null fields', () => {
  expect(gradeClassify(actual, { intent: 'plan', patch: { ...actual.patch }, clarifyField: null })[3])
    .toEqual({ name: 'patch_field_tripType', value: 1 });
  const filled = { destination: 'Kyoto', tripType: 'solo', departureDate: '2026-12-01', returnDate: '2026-12-02', travelers: 1, preferences: 'quiet', budget: 500, budgetCurrency: 'USD' } as const;
  expect(gradeClassify({ ...actual, patch: filled }, { intent: 'plan', patch: filled, clarifyField: null }))
    .toContainEqual({ name: 'patch_hallucination', value: 0 });
});

it('matches free-text destination and preferences by containment, other fields exactly', () => {
  const loose = { ...actual.patch, destination: '京都市', preferences: '喜欢 安静的地方', travelers: 2 };
  expect(gradeClassify({ ...actual, patch: loose }, { intent: 'plan', patch: { destination: '京都', preferences: '安静', travelers: 3 }, clarifyField: null }))
    .toEqual([
      { name: 'intent_acc', value: 1 }, { name: 'patch_exact', value: 0 },
      { name: 'patch_field_destination', value: 1 }, { name: 'patch_field_travelers', value: 0 },
      { name: 'patch_field_preferences', value: 1 }, { name: 'patch_hallucination', value: 0 },
      { name: 'clarify_match', value: 1 },
    ]);
});

it('computes clarification presence recall and precision, ignoring true negatives', () => {
  expect(gradeClarify([
    { expected: 'destination', actual: 'destination' }, { expected: 'dates', actual: null },
    { expected: null, actual: 'other' }, { expected: null, actual: null },
  ])).toEqual([{ name: 'clarify_recall', value: 0.5 }, { name: 'clarify_precision', value: 0.5 }]);
  expect(gradeClarify([{ expected: 'dates', actual: 'destination' }]))
    .toEqual([{ name: 'clarify_recall', value: 1 }, { name: 'clarify_precision', value: 1 }]);
  expect(gradeClarify([])).toEqual([{ name: 'clarify_recall', value: 1 }, { name: 'clarify_precision', value: 1 }]);
});

import { planningResponse } from './ui-flow.components.js';
import { readUIFlowSnapshot, toPublicMessageMetadata } from './ui-session.js';
import { aiUIResponseSchema } from '@autix/contracts';

it('editing requirements carries saved values and does not ask for a budget', () => {
  const response = planningResponse({
    stage: 'collecting_requirements', editingRequirements: true, replyLanguage: 'zh',
    requirements: { destination: '京都', departureDate: '2026-10-05', returnDate: '2026-10-07', travelers: 1, preferences: '自然风景' },
    itinerary: 'draft', query: null,
  });
  const form = response.components.find(c => c.type === 'form')!;
  expect(form).toMatchObject({ initialValues: [
    { name: 'destination', value: '京都' }, { name: 'departureDate', value: '2026-10-05' },
    { name: 'returnDate', value: '2026-10-07' }, { name: 'travelers', value: 1 },
    { name: 'preferences', value: '自然风景' },
  ] });
  if (form.type === 'form') expect(form.fields.map(f => f.name)).not.toContain('budget');
});

it('upgrades persisted planning forms consistently for display and action validation', () => {
  const legacyForm = { id: 'saved-form', type: 'form', title: '旅游需求', submitLabel: '生成路线草案', fields: [
    { type: 'input', name: 'destination', label: '目的地', required: true, placeholder: null },
    { type: 'number', name: 'budget', label: '总预算', required: true, min: 0, max: null },
  ] };
  const metadata = { components: [legacyForm], uiFlowSnapshot: {
    version: 1, revision: 4, trip: null,
    context: { stage: 'collecting_requirements', editingRequirements: true, replyLanguage: 'zh',
      requirements: { destination: '京都', departureDate: '2026-10-05', returnDate: '2026-10-07', travelers: 1 }, itinerary: null, query: null },
    response: { intent: 'trip_planning', message: '修改需求', components: [legacyForm] },
  } };
  const snapshot = readUIFlowSnapshot(metadata)!;
  const visible = toPublicMessageMetadata(metadata)!;
  expect(snapshot.response.components[0]).toMatchObject({ id: 'saved-form', initialValues: [{ name: 'destination', value: '京都' }, { name: 'departureDate', value: '2026-10-05' }, { name: 'returnDate', value: '2026-10-07' }, { name: 'travelers', value: 1 }] });
  expect(visible.components).toEqual(snapshot.response.components);
  expect(snapshot.revision).toBe(4);
  const budgetOnly = structuredClone(metadata);
  budgetOnly.uiFlowSnapshot.context.editingRequirements = false;
  Object.assign(budgetOnly.uiFlowSnapshot.context.requirements, { preferences: '自然风景' });
  const restored = readUIFlowSnapshot(budgetOnly)!;
  expect(aiUIResponseSchema.safeParse(restored.response).success).toBe(true);
  const form = visible.components![0];
  if (form.type === 'form') expect(form.fields.map(f => f.name)).not.toContain('budget');
});

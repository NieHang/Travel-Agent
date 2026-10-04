import {
  getUICopy,
  normalizeLocale,
  resolveReplyLanguage,
} from './ui-localization.js';
import {
  getPlanningFields,
  getTripOptions,
  planningResponse,
} from './ui-flow.components.js';
import type { UIFlowContext } from './ui-types.js';

describe('UI language resources', () => {
  it('normalizes preferences and preserves prior language for ambiguous replies', () => {
    expect(normalizeLocale('en-us')).toBe('en-US');
    expect(resolveReplyLanguage('en', 'zh', 'zh')).toBe('en');
    expect(resolveReplyLanguage(undefined, undefined, 'en')).toBe('en');
    expect(resolveReplyLanguage(undefined, undefined, undefined)).toBe('en');
    expect(() => normalizeLocale('not valid')).toThrow();
  });
  it('falls back by language or to English for unregistered dictionaries', () => {
    expect(getUICopy('zh-CN')).toEqual(getUICopy('zh'));
    expect(getUICopy('fr')).toEqual(getUICopy('en'));
    expect(Object.keys(getUICopy('zh'))).toEqual(Object.keys(getUICopy('en')));
  });
  it('localizes forms without changing identifiers or requiring currency', () => {
    expect(getPlanningFields('en').map((f) => f.name)).toEqual(
      getPlanningFields('zh').map((f) => f.name),
    );
    expect(
      getPlanningFields('en').some((f) => f.name === 'budgetCurrency'),
    ).toBe(false);
    expect(
      getPlanningFields('en').find((f) => f.name === 'budget')?.label,
    ).toBe('Total budget');
    expect(getTripOptions('en').map((o) => o.value)).toEqual(
      getTripOptions('zh').map((o) => o.value),
    );
  });
  it.each([
    'choosing_trip_type',
    'collecting_requirements',
    'reviewing_itinerary',
    'awaiting_confirmation',
    'confirmed',
  ] as const)('renders fixed English components at %s', (stage) => {
    const context: UIFlowContext = {
      stage,
      replyLanguage: 'en',
      requirements: {},
      itinerary: 'Tokyo draft',
      query: null,
    };
    const response = planningResponse(context);
    expect(JSON.stringify(response)).not.toMatch(/[\u3400-\u9fff]/);
    expect(response.components.some((c) => c.type === 'steps')).toBe(true);
    if (stage === 'choosing_trip_type')
      expect(
        response.components.find((c) => c.type === 'selection'),
      ).toMatchObject({ purpose: 'trip_type' });
  });
});

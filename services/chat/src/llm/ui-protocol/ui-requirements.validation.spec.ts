import { mergePlanningRequirements } from './ui-requirements.validation.js';

describe('planning requirement patches', () => {
  it('preserves null fields and recognizes unchanged values', () => {
    expect(
      mergePlanningRequirements(
        { destination: 'Tokyo', budget: 5000 },
        { destination: null, budget: 5000 },
      ),
    ).toEqual({
      requirements: { destination: 'Tokyo', budget: 5000 },
      changed: false,
    });
    expect(
      mergePlanningRequirements({ budget: 5000 }, { budget: 6000 }).changed,
    ).toBe(true);
  });
  it('preserves return-date role and accepts budget without a currency', () => {
    expect(
      mergePlanningRequirements({}, { returnDate: '2026-11-03', budget: 5000 })
        .requirements,
    ).toEqual({ returnDate: '2026-11-03', budget: 5000 });
    expect(
      mergePlanningRequirements({}, { budgetCurrency: 'USD' }).requirements
        .budgetCurrency,
    ).toBe('USD');
  });
  it.each([
    { travelers: 0 },
    { travelers: 101 },
    { travelers: 1.5 },
    { budget: -1 },
    { budget: Infinity },
    { departureDate: '2026-02-30' },
    { tripType: 'holiday' },
    { budgetCurrency: 'dollars' },
    { unknown: 1 },
  ])('rejects invalid patch %j', (patch) => {
    expect(() => mergePlanningRequirements({}, patch as never)).toThrow();
  });
  it('validates dates against existing requirements without mutation', () => {
    const existing = { departureDate: '2026-11-03', returnDate: '2026-11-05' };
    expect(() =>
      mergePlanningRequirements(existing, { returnDate: '2026-11-01' }),
    ).toThrow();
    expect(existing.returnDate).toBe('2026-11-05');
  });
});

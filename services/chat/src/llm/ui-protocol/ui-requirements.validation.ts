import { BadRequestException } from '@nestjs/common';
import { planningRequirementsSchema } from './ui-schemas.js';
import type { PlanningRequirements, UIFlowContext } from './ui-types.js';

export function isValidISODate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function mergePlanningRequirements(
  existing: UIFlowContext['requirements'],
  patch: Partial<PlanningRequirements>,
): { requirements: UIFlowContext['requirements']; changed: boolean } {
  const parsed = planningRequirementsSchema.partial().safeParse(patch);
  const fail = (): never => {
    throw new BadRequestException('Invalid planning requirements');
  };
  if (!parsed.success) return fail();
  const requirements = { ...existing };
  let changed = false;
  for (const [name, raw] of Object.entries(parsed.data)) {
    if (raw === null || raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (
      name === 'travelers' &&
      (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100)
    )
      fail();
    if (name === 'budget' && (typeof value !== 'number' || value < 0)) fail();
    if (
      (name === 'departureDate' || name === 'returnDate') &&
      (typeof value !== 'string' || !isValidISODate(value))
    )
      fail();
    if (
      name === 'budgetCurrency' &&
      (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
    )
      fail();
    if (requirements[name] !== value) changed = true;
    requirements[name] = value;
  }
  if (
    typeof requirements.departureDate === 'string' &&
    typeof requirements.returnDate === 'string' &&
    requirements.departureDate > requirements.returnDate
  )
    fail();
  return { requirements, changed };
}

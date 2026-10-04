import { BadRequestException } from '@nestjs/common';
import type { UIAction, UIResponse } from './ui-types.js';
import { isValidISODate } from './ui-requirements.validation.js';

export function validateForm(
  component: Extract<UIResponse, { type: 'form' }>,
  action: Extract<UIAction, { type: 'form_submit' }>,
  existing: Record<string, string | number | boolean | null>,
) {
  const fail = () => {
    throw new BadRequestException('Invalid form values');
  };
  if (new Set(action.values.map((v) => v.name)).size !== action.values.length)
    fail();
  const submitted: Record<string, string | number | boolean | null> =
    Object.create(null);
  for (const { name, value } of action.values) {
    const field = component.fields.find((f) => f.name === name);
    if (!field || ['__proto__', 'constructor', 'prototype'].includes(name))
      return fail();
    const blank =
      value === null || (typeof value === 'string' && !value.trim());
    if (blank) {
      if (field.required) fail();
      submitted[name] = null;
      continue;
    }
    if (field.type === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (field.min !== null && value < field.min) ||
        (field.max !== null && value > field.max)
      )
        fail();
      if (
        name === 'travelers' &&
        (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
      )
        fail();
      if (name === 'budget' && (typeof value !== 'number' || value < 0)) fail();
    } else {
      if (typeof value !== 'string') return fail();
      if (
        field.type === 'select' &&
        !field.options.some((o) => o.value === value)
      )
        fail();
      if (field.type === 'date' && !isValidISODate(value)) fail();
    }
    submitted[name] = typeof value === 'string' ? value.trim() : value;
  }
  if (
    component.fields.some(
      (f) =>
        f.required &&
        (submitted[f.name] === undefined ||
          submitted[f.name] === null ||
          submitted[f.name] === ''),
    )
  )
    fail();
  const combined = { ...existing, ...submitted };
  if (
    typeof combined.departureDate === 'string' &&
    typeof combined.returnDate === 'string' &&
    combined.departureDate > combined.returnDate
  )
    fail();
  return submitted;
}

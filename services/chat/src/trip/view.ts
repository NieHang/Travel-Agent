import { TRIP_TYPES, type Command, type Component, type Field } from '@autix/contracts';
import type { Copy } from './copy.js';
import type { TripState } from './state.js';

const FORM_FIELDS = ['destination', 'departureDate', 'returnDate', 'travelers', 'preferences'] as const;
type FormFieldName = (typeof FORM_FIELDS)[number];

function field(name: FormFieldName, c: Copy): Field {
  const { label, placeholder } = c.fields[name];
  const kind = name === 'preferences' ? 'textarea' : name === 'travelers' ? 'number' : name === 'destination' ? 'text' : 'date';
  return {
    name,
    kind,
    label,
    required: name !== 'preferences',
    placeholder,
    min: name === 'travelers' ? 1 : null,
    max: name === 'travelers' ? 100 : null,
  };
}

function tripTypeChoice(s: TripState, c: Copy): Component {
  return {
    type: 'choice',
    command: 'set_trip_type',
    title: s.clarify?.field === 'tripType' ? s.clarify.question : c.tripTypeTitle,
    options: TRIP_TYPES.map((value) => ({ value, ...c.tripTypes[value] })),
  };
}

function requirementsForm(s: TripState, c: Copy): Component {
  const r = s.requirements;
  const datesMissing = !r.departureDate || !r.returnDate;
  const fields = FORM_FIELDS.filter((name) =>
    name === 'preferences' ? true : name === 'departureDate' || name === 'returnDate' ? datesMissing : r[name] === undefined,
  ).map((name) => field(name, c));
  return { type: 'form', command: 'submit_requirements', title: c.requirementsTitle, fields, initialValues: r, submitLabel: c.generateDraft };
}

/** The only place components are built. Pure: same state, same components. */
export function render(s: TripState, c: Copy): Component[] {
  const out: Component[] = [];
  const shown = s.results.filter((g) => g.items.length > 0);
  if (shown.length) {
    for (const group of shown) out.push({ type: 'cards', items: group.items });
    if (s.stage !== 'idle') out.push({ type: 'buttons', buttons: [{ command: 'resume', label: c.resume }] });
    return out;
  }
  if (s.clarify?.field === 'destination' && s.clarify.options.length)
    out.push({
      type: 'choice',
      command: 'set_destination',
      title: s.clarify.question,
      options: s.clarify.options.map((value) => ({ value, label: value, description: null })),
    });
  switch (s.stage) {
    case 'idle':
      break;
    case 'trip_type':
      out.push(tripTypeChoice(s, c));
      break;
    case 'requirements':
      out.push(requirementsForm(s, c));
      break;
    case 'review':
      if (s.stays?.items.length) out.push({ type: 'cards', items: s.stays.items });
      out.push({ type: 'buttons', buttons: [{ command: 'confirm', label: c.confirm }, { command: 'edit', label: c.edit }] });
      break;
    case 'confirmed':
      out.push({ type: 'buttons', buttons: [{ command: 'edit', label: c.edit }] });
      break;
  }
  return out;
}

/** Assistant text for turns where the LLM wrote nothing. */
export function stageMessage(s: TripState, c: Copy): string {
  if (s.clarify) return s.clarify.question;
  switch (s.stage) {
    case 'trip_type':
      return c.chooseType;
    case 'requirements':
      return c.collect;
    case 'review':
      return c.review;
    case 'confirmed':
      return c.confirmed;
    case 'idle':
      return '';
  }
}

/** The user-visible message saved for a command. */
export function describe(command: Command, c: Copy): string {
  switch (command.type) {
    case 'message':
      return command.text;
    case 'set_trip_type':
      return c.tripTypes[command.value].label;
    case 'set_destination':
      return command.value;
    case 'submit_requirements':
      return FORM_FIELDS.filter((name) => command.values[name] !== undefined && command.values[name] !== '')
        .map((name) => `${c.fields[name].label}${c.separator}${command.values[name]}`)
        .join('\n');
    case 'confirm':
      return c.confirm;
    case 'edit':
      return c.edit;
    case 'resume':
      return c.resume;
  }
}

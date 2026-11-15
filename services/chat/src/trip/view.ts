import { TRIP_TYPES, type Command, type Component, type FormField, type FormFieldName, type Requirements } from '@autix/contracts';
import type { Copy } from './copy.js';
import type { TripState } from './state.js';

const FIELD_BUILDERS: { [N in FormFieldName]: (r: Requirements, c: Copy) => Extract<FormField, { name: N }> } = {
  destination: (r, c) => ({
    name: 'destination', ...c.fields.destination, value: r.destination ?? null, suggestions: c.japanCities,
  }),
  dates: (r, c) => ({
    name: 'dates', label: c.fields.dates.label,
    value: r.departureDate && r.returnDate ? { start: r.departureDate, end: r.returnDate } : null,
  }),
  travelers: (r, c) => ({
    name: 'travelers', label: c.fields.travelers.label, value: r.travelers ?? (r.tripType === 'solo' ? 1 : 2),
  }),
  preferences: (r, c) => ({
    name: 'preferences', ...c.fields.preferences, value: r.preferences ?? '', suggestions: c.preferenceTags,
  }),
};

function tripTypeChoice(s: TripState, c: Copy): Component {
  return {
    type: 'choice',
    command: 'set_trip_type',
    title: s.clarify?.field === 'tripType' ? s.clarify.question : c.tripTypeTitle,
    options: TRIP_TYPES.map((value) => ({ value, ...c.tripTypes[value] })),
  };
}

function requirementsForm(s: TripState, c: Copy): Component {
  const fields = Object.values(FIELD_BUILDERS).map((build) => build(s.requirements, c));
  return { type: 'form', command: 'submit_requirements', title: c.requirementsTitle, fields, submitLabel: c.generateDraft };
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
  if (s.outsideJapan)
    out.push({
      type: 'choice',
      command: 'set_destination',
      title: c.japanDestinationTitle,
      options: [...new Set([...(s.outsideJapan.japan ? [s.outsideJapan.japan] : []), ...c.japanCities])]
        .slice(0, 5).map((value) => ({ value, label: value, description: null })),
    });
  else if (s.clarify?.field === 'destination' && s.clarify.options.length)
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
      out.push({ type: 'buttons', buttons: [{ command: 'confirm', label: c.confirm }, { command: 'edit', label: c.edit }] });
      break;
    case 'confirmed':
      out.push({ type: 'buttons', buttons: [{ command: 'edit', label: c.edit }] });
      break;
  }
  return out;
}

/** Assistant text for turns where the LLM wrote nothing. */
export function stageMessage(s: TripState, c: Copy, command?: Command): string {
  if (command?.type === 'choose_stay') return c.stayChosen(hotelName(s, command.ref), c.nights(command.nights.from, command.nights.to));
  if (s.outsideJapan) return c.outsideJapan(s.outsideJapan.places, s.outsideJapan.japan);
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

const hotelName = (s: TripState, ref: string) => s.stays?.items.find((h) => h.ref === ref)?.title.original ?? ref;

/** The user-visible message saved for a command; `s` is the state the command applies to. */
export function describe(command: Command, c: Copy, s: TripState): string {
  switch (command.type) {
    case 'message':
      return command.text;
    case 'set_trip_type':
      return c.tripTypes[command.value].label;
    case 'set_destination':
      return command.value;
    case 'submit_requirements':
      return Object.values(FIELD_BUILDERS).flatMap((build) => {
        const field = build(command.values, c);
        const value = field.name === 'dates'
          ? field.value && `${field.value.start} → ${field.value.end}`
          : command.values[field.name];
        return value === undefined || value === null || value === '' ? [] : [`${field.label}${c.separator}${value}`];
      }).join('\n');
    case 'confirm':
      return c.confirm;
    case 'edit':
      return c.edit;
    case 'resume':
      return c.resume;
    case 'choose_stay':
      return c.chooseStay(hotelName(s, command.ref), c.nights(command.nights.from, command.nights.to));
  }
}

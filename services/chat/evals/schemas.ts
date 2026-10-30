import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RequirementsSchema, ResultGroupSchema } from '@autix/contracts';
import { ClassifiedSchema } from '../src/trip/commands.js';
import { ClarifySchema, STAGES } from '../src/trip/state.js';

export const SuiteSchema = z.enum(['classify', 'extract-days']);
export type Suite = z.infer<typeof SuiteSchema>;

const common = {
  id: z.string().min(1), category: z.string().min(1), locale: z.enum(['zh', 'en']),
  today: z.string().date(), note: z.string().optional(),
};

export const ClassifyEntrySchema = z.object({
  ...common,
  state: z.object({ stage: z.enum(STAGES), requirements: RequirementsSchema }).strict(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() }).strict()),
  text: z.string().min(1),
  expected: z.object({
    intent: ClassifiedSchema.shape.intent,
    patch: z.object({
      destination: RequirementsSchema.shape.destination.unwrap().nullable(),
      tripType: RequirementsSchema.shape.tripType.unwrap().nullable(),
      departureDate: z.string().date().nullable(),
      returnDate: z.string().date().nullable(),
      travelers: RequirementsSchema.shape.travelers.unwrap().nullable(),
      preferences: RequirementsSchema.shape.preferences.unwrap().nullable(),
      budget: RequirementsSchema.shape.budget.unwrap().nullable(),
      budgetCurrency: RequirementsSchema.shape.budgetCurrency.unwrap().nullable(),
    }).partial().strict(),
    clarifyField: ClarifySchema.shape.field.nullable(),
  }).strict(),
}).strict();
export type ClassifyEntry = z.infer<typeof ClassifyEntrySchema>;

export const ExtractDaysEntrySchema = z.object({
  ...common, draft: z.string().min(1), stays: ResultGroupSchema.nullable(),
  expected: z.object({ days: z.array(z.object({ stops: z.array(z.string()), stayRef: z.string().nullable() }).strict()) }).strict(),
}).strict();
export type ExtractDaysEntry = z.infer<typeof ExtractDaysEntrySchema>;
export type Entry = ClassifyEntry | ExtractDaysEntry;

export const ScoreSchema = z.object({ name: z.string(), value: z.number().finite(), comment: z.string().optional() });
export type Score = z.infer<typeof ScoreSchema>;

const result = {
  runName: z.string(), metadata: z.record(z.unknown()), experimentUrl: z.string().optional(),
  scores: z.array(ScoreSchema),
};
// A failed task (e.g. the model's structured output does not parse) keeps its item with a null output and the error.
const item = { id: z.string(), category: z.string(), scores: z.array(ScoreSchema), error: z.string().optional() };
export const ResultSchema = z.discriminatedUnion('suite', [
  z.object({ ...result, suite: z.literal('classify'), items: z.array(z.object({ ...item, output: ClassifiedSchema.nullable() })) }),
  z.object({ ...result, suite: z.literal('extract-days'), items: z.array(z.object({ ...item, output: ExtractDaysEntrySchema.shape.expected.shape.days.nullable() })) }),
]);
export type RunResult = z.infer<typeof ResultSchema>;

export async function readDataset(suite: Suite): Promise<Entry[]> {
  const raw = await readFile(new URL(`./datasets/${suite}.jsonl`, import.meta.url), 'utf8');
  const schema = suite === 'classify' ? ClassifyEntrySchema : ExtractDaysEntrySchema;
  const entries = raw.split(/\r?\n/).filter((line) => line.trim()).map((line) => schema.parse(JSON.parse(line)));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error(`Duplicate ids in ${suite}`);
  return entries;
}

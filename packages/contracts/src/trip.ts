import { z } from 'zod';
import { uiResponseSchema } from './ui';

export const TripSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  status: z.enum(['collecting', 'draft', 'confirmed', 'updating']),
  destination: z.string().nullable(),
  departureDate: z.string().nullable(),
  returnDate: z.string().nullable(),
  travelers: z.number().int().min(1).max(100).nullable(),
  budget: z.number().finite().nonnegative().nullable(),
  budgetCurrency: z.string().nullable(),
  itineraryMarkdown: z.string().nullable(),
  days: z.array(
    z.object({
      title: z.string(),
      stops: z.array(
        z.object({
          name: z.string(),
          note: z.string().nullable(),
          time: z.string().nullable(),
        }),
      ),
    }),
  ),
  hotels: z.array(uiResponseSchema),
  routes: z.array(uiResponseSchema),
  hotspots: z.array(uiResponseSchema),
});
export type TripSnapshot = z.infer<typeof TripSnapshotSchema>;

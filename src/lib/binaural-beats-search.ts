import { z } from 'zod';

import {
  BEAT_MAX,
  BEAT_MIN,
  CARRIER_MAX,
  CARRIER_MIN,
  MODES,
  NOISE_TYPES,
  TIMER_MINUTES_OPTIONS,
} from '@/lib/binaural-beats-utils';

// Every field is `.catch(undefined)` so a stale, hand-edited, or out-of-range shared
// URL (e.g. ?beat=500) falls back to the default instead of throwing and crashing the
// route; the page's `?? DEFAULT_*` reads then supply the default. No `preset` field:
// the active preset is derived from beat + carrier by `findMatchingPreset`.
export const searchSchema = z.object({
  beat: z.number().min(BEAT_MIN).max(BEAT_MAX).optional().catch(undefined),
  carrier: z.number().min(CARRIER_MIN).max(CARRIER_MAX).optional().catch(undefined),
  mode: z.enum(MODES).optional().catch(undefined),
  noise: z.enum(NOISE_TYPES).optional().catch(undefined),
  noiseLevel: z.number().min(0).max(1).optional().catch(undefined),
  timer: z
    .literal([...TIMER_MINUTES_OPTIONS])
    .optional()
    .catch(undefined),
  volume: z.number().min(0).max(1).optional().catch(undefined),
});

// Single source of truth for the shape, derived from the schema so the two can't drift.
export type SearchParams = z.infer<typeof searchSchema>;

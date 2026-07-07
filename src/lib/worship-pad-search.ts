import { z } from 'zod';

import { KEYS, MODES, SYNTH_PRESETS, VARIANTS } from '@/lib/worship-pad-utils';

// Octave bounds, shared by the search schema and the page's octave controls.
export const OCTAVE_MIN = 1;
export const OCTAVE_MAX = 4;

// Every field is `.catch(undefined)` so a stale, hand-edited, or out-of-range
// shared URL (e.g. ?octave=8) falls back to the default instead of throwing and
// crashing the route; the page's `?? DEFAULT_*` reads then supply the default.
export const searchSchema = z.object({
  attack: z.number().min(0.1).max(4).optional().catch(undefined),
  drone: z.boolean().optional().catch(undefined),
  key: z.enum(KEYS).optional().catch(undefined),
  mode: z.enum(MODES).optional().catch(undefined),
  octave: z.number().int().min(OCTAVE_MIN).max(OCTAVE_MAX).optional().catch(undefined),
  preset: z.enum(SYNTH_PRESETS).optional().catch(undefined),
  release: z.number().min(0.3).max(6).optional().catch(undefined),
  reverb: z.number().min(0).max(1).optional().catch(undefined),
  shimmer: z.boolean().optional().catch(undefined),
  shimmerReverb: z.number().min(0).max(0.85).optional().catch(undefined),
  subRoot: z.boolean().optional().catch(undefined),
  variant: z.enum(VARIANTS).optional().catch(undefined),
  volume: z.number().min(0).max(1).optional().catch(undefined),
});

// Single source of truth for the shape, derived from the schema so the two
// can't drift.
export type SearchParams = z.infer<typeof searchSchema>;

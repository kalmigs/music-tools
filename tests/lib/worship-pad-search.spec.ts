import { describe, expect, it } from 'vitest';

import { searchSchema } from '@/lib/worship-pad-search';

describe('worship-pad searchSchema', () => {
  it('passes valid params through unchanged', () => {
    const input = {
      attack: 1.5,
      drone: true,
      key: 'D',
      mode: 'minor',
      octave: 3,
      preset: 'bell',
      release: 4,
      reverb: 0.5,
      shimmer: true,
      shimmerReverb: 0.4,
      subRoot: false,
      variant: 'sus4',
      volume: 0.8,
    };
    expect(searchSchema.parse(input)).toEqual(input);
  });

  it('leaves omitted params undefined', () => {
    expect(searchSchema.parse({})).toEqual({});
  });

  // The whole point of the schema hardening: a bad shared/edited URL must fall
  // back to the default (undefined) rather than throw and crash the route.
  it('drops out-of-range numeric params to undefined without throwing', () => {
    expect(() => searchSchema.parse({ octave: 8 })).not.toThrow();
    expect(searchSchema.parse({ octave: 8 }).octave).toBeUndefined();
    expect(searchSchema.parse({ octave: 0 }).octave).toBeUndefined();
    expect(searchSchema.parse({ octave: 2.5 }).octave).toBeUndefined();
    expect(searchSchema.parse({ volume: 2 }).volume).toBeUndefined();
    expect(searchSchema.parse({ volume: -1 }).volume).toBeUndefined();
    expect(searchSchema.parse({ shimmerReverb: 0.9 }).shimmerReverb).toBeUndefined();
    expect(searchSchema.parse({ attack: 99 }).attack).toBeUndefined();
    expect(searchSchema.parse({ release: 0.1 }).release).toBeUndefined();
  });

  it('drops unknown enum values to undefined without throwing', () => {
    expect(() => searchSchema.parse({ key: 'H', mode: 'dorian' })).not.toThrow();
    expect(searchSchema.parse({ key: 'H' }).key).toBeUndefined();
    expect(searchSchema.parse({ mode: 'dorian' }).mode).toBeUndefined();
    expect(searchSchema.parse({ preset: 'synth' }).preset).toBeUndefined();
    expect(searchSchema.parse({ variant: 'power' }).variant).toBeUndefined();
  });

  it('drops only the invalid field, keeping valid siblings', () => {
    const result = searchSchema.parse({ octave: 8, volume: 0.3, key: 'E' });
    expect(result.octave).toBeUndefined();
    expect(result.volume).toBe(0.3);
    expect(result.key).toBe('E');
  });
});

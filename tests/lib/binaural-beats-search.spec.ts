import { describe, expect, it } from 'vitest';

import { searchSchema } from '@/lib/binaural-beats-search';

describe('binaural-beats searchSchema', () => {
  it('passes valid params through unchanged', () => {
    const input = {
      beat: 10,
      carrier: 200,
      mode: 'isochronic',
      noise: 'pink',
      noiseLevel: 0.4,
      timer: 30,
      volume: 0.5,
    };
    expect(searchSchema.parse(input)).toEqual(input);
  });

  it('leaves omitted params undefined', () => {
    expect(searchSchema.parse({})).toEqual({});
  });

  // The whole point of the schema hardening: a bad shared/edited URL must fall back to
  // the default (undefined) rather than throw and crash the route.
  it('drops out-of-range numeric params to undefined without throwing', () => {
    expect(() => searchSchema.parse({ beat: 500 })).not.toThrow();
    expect(searchSchema.parse({ beat: 500 }).beat).toBeUndefined();
    expect(searchSchema.parse({ beat: 0 }).beat).toBeUndefined();
    expect(searchSchema.parse({ carrier: 50 }).carrier).toBeUndefined();
    expect(searchSchema.parse({ carrier: 501 }).carrier).toBeUndefined();
    expect(searchSchema.parse({ volume: 2 }).volume).toBeUndefined();
    expect(searchSchema.parse({ noiseLevel: -1 }).noiseLevel).toBeUndefined();
  });

  it('drops unknown enum and timer values to undefined without throwing', () => {
    expect(() => searchSchema.parse({ mode: 'stereo', noise: 'white', timer: 7 })).not.toThrow();
    expect(searchSchema.parse({ mode: 'stereo' }).mode).toBeUndefined();
    expect(searchSchema.parse({ noise: 'white' }).noise).toBeUndefined();
    expect(searchSchema.parse({ timer: 7 }).timer).toBeUndefined();
    expect(searchSchema.parse({ timer: '30' }).timer).toBeUndefined();
  });

  it('accepts every timer option including off', () => {
    for (const minutes of [0, 15, 30, 45, 60, 90]) {
      expect(searchSchema.parse({ timer: minutes }).timer).toBe(minutes);
    }
  });

  it('drops only the invalid field, keeping valid siblings', () => {
    const result = searchSchema.parse({ beat: 500, carrier: 220, mode: 'binaural' });
    expect(result.beat).toBeUndefined();
    expect(result.carrier).toBe(220);
    expect(result.mode).toBe('binaural');
  });
});

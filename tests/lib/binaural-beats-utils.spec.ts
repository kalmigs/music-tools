import { describe, expect, it } from 'vitest';

import {
  BEAT_MAX,
  BEAT_MIN,
  CARRIER_MAX,
  CARRIER_MIN,
  clampBeat,
  clampCarrier,
  classifyBand,
  computeFadeOutSchedule,
  FADE_OUT_SECONDS,
  findMatchingPreset,
  generateBrownNoiseSamples,
  generatePinkNoiseSamples,
  getEarFrequencies,
  PRESET_IDS,
  PRESETS,
} from '@/lib/binaural-beats-utils';

// Statistical helpers for the noise generators. Exact samples are random, so the tests
// assert shape properties with generous tolerances instead.
function mean(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s;
  return sum / samples.length;
}

function variance(samples: Float32Array): number {
  const m = mean(samples);
  let sum = 0;
  for (const s of samples) sum += (s - m) ** 2;
  return sum / samples.length;
}

/** Mean squared sample-to-sample difference over variance: lower means smoother. */
function roughness(samples: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < samples.length; i += 1) sum += (samples[i] - samples[i - 1]) ** 2;
  return sum / (samples.length - 1) / variance(samples);
}

describe('clampBeat / clampCarrier', () => {
  it('pass through in-range values', () => {
    expect(clampBeat(10)).toBe(10);
    expect(clampCarrier(200)).toBe(200);
  });

  it('clamp to the supported ranges', () => {
    expect(clampBeat(0)).toBe(BEAT_MIN);
    expect(clampBeat(999)).toBe(BEAT_MAX);
    expect(clampCarrier(1)).toBe(CARRIER_MIN);
    expect(clampCarrier(9999)).toBe(CARRIER_MAX);
  });
});

describe('classifyBand', () => {
  it('maps each band with lower-inclusive boundaries', () => {
    expect(classifyBand(0.5)).toBe('delta');
    expect(classifyBand(3.9)).toBe('delta');
    expect(classifyBand(4)).toBe('theta');
    expect(classifyBand(8)).toBe('alpha');
    expect(classifyBand(13)).toBe('beta');
    expect(classifyBand(30)).toBe('gamma');
    expect(classifyBand(40)).toBe('gamma');
  });

  it('classifies every preset into its intended band', () => {
    const bands = PRESETS.map(p => classifyBand(p.beatHz));
    expect(bands).toEqual(['delta', 'theta', 'alpha', 'beta', 'gamma']);
  });
});

describe('PRESETS', () => {
  it('covers every preset id once, in order, within the slider bounds', () => {
    expect(PRESETS.map(p => p.id)).toEqual([...PRESET_IDS]);
    for (const preset of PRESETS) {
      expect(preset.beatHz).toBeGreaterThanOrEqual(BEAT_MIN);
      expect(preset.beatHz).toBeLessThanOrEqual(BEAT_MAX);
      expect(preset.carrierHz).toBeGreaterThanOrEqual(CARRIER_MIN);
      expect(preset.carrierHz).toBeLessThanOrEqual(CARRIER_MAX);
    }
  });
});

describe('findMatchingPreset', () => {
  it('returns the preset on an exact beat + carrier match', () => {
    expect(findMatchingPreset(10, 200)).toBe('calmFocus');
    expect(findMatchingPreset(2, 150)).toBe('sleep');
  });

  // The whole point of deriving the preset: any slider move deselects it.
  it('returns null when either value drifts', () => {
    expect(findMatchingPreset(10.5, 200)).toBeNull();
    expect(findMatchingPreset(10, 201)).toBeNull();
  });
});

describe('getEarFrequencies', () => {
  it('puts the carrier in the left ear and carrier + beat in the right', () => {
    expect(getEarFrequencies(200, 10)).toEqual({ left: 200, right: 210 });
  });

  it('keeps the ear difference equal to the beat for fractional beats', () => {
    const { left, right } = getEarFrequencies(150, 0.5);
    expect(right - left).toBeCloseTo(0.5);
  });
});

describe('computeFadeOutSchedule', () => {
  it('ends at the timer duration and starts one fade earlier', () => {
    expect(computeFadeOutSchedule(30 * 60)).toEqual({
      fadeStartSeconds: 30 * 60 - FADE_OUT_SECONDS,
      fadeEndSeconds: 30 * 60,
    });
  });

  it('accepts a custom fade length', () => {
    expect(computeFadeOutSchedule(600, 10)).toEqual({ fadeStartSeconds: 590, fadeEndSeconds: 600 });
  });

  it('fades from the start when the timer is shorter than the fade', () => {
    expect(computeFadeOutSchedule(10)).toEqual({ fadeStartSeconds: 0, fadeEndSeconds: 10 });
  });
});

describe('noise generators', () => {
  const LENGTH = 44100;

  for (const [name, generate] of [
    ['pink', generatePinkNoiseSamples],
    ['brown', generateBrownNoiseSamples],
  ] as const) {
    describe(name, () => {
      const samples = generate(LENGTH, { edgeFadeSamples: 100 });

      it('has the requested length and stays within [-1, 1]', () => {
        expect(samples.length).toBe(LENGTH);
        for (const s of samples) {
          expect(s).toBeGreaterThanOrEqual(-1);
          expect(s).toBeLessThanOrEqual(1);
        }
      });

      it('is peak-normalized and not silent', () => {
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s));
        expect(peak).toBeCloseTo(1, 1);
        expect(variance(samples)).toBeGreaterThan(0.001);
      });

      it('has near-zero DC offset', () => {
        expect(Math.abs(mean(samples))).toBeLessThan(0.15);
      });

      // toBeCloseTo, not toBe: the envelope can yield -0, which Object.is rejects.
      it('fades both edges to silence so the loop seam does not click', () => {
        expect(samples[0]).toBeCloseTo(0, 10);
        expect(samples[LENGTH - 1]).toBeCloseTo(0, 10);
        expect(Math.abs(samples[50])).toBeLessThan(0.6);
      });
    });
  }

  it('produces brown noise that is smoother than pink noise', () => {
    const pink = generatePinkNoiseSamples(LENGTH);
    const brown = generateBrownNoiseSamples(LENGTH);
    expect(roughness(brown)).toBeLessThan(roughness(pink));
  });

  it('caps the edge fade at half the buffer for tiny buffers', () => {
    const tiny = generatePinkNoiseSamples(8);
    expect(tiny.length).toBe(8);
    expect(tiny[0]).toBeCloseTo(0, 10);
    expect(tiny[7]).toBeCloseTo(0, 10);
  });
});

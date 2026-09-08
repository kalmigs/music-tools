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
  computeTimerRebase,
  computeTransportGain,
  FADE_IN_SECONDS,
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

describe('computeTransportGain', () => {
  const TIMER = 15 * 60;

  it('ramps in from silence over the fade-in window', () => {
    expect(computeTransportGain(0, 0).gain).toBe(0);
    expect(computeTransportGain(FADE_IN_SECONDS / 2, 0).gain).toBeCloseTo(0.5);
    expect(computeTransportGain(FADE_IN_SECONDS, 0).gain).toBe(1);
  });

  it('holds at full gain forever when no timer is set', () => {
    expect(computeTransportGain(60, 0)).toEqual({ complete: false, gain: 1 });
    expect(computeTransportGain(60 * 60 * 5, 0)).toEqual({ complete: false, gain: 1 });
  });

  it('holds at full gain until the fade-out begins', () => {
    const { fadeStartSeconds } = computeFadeOutSchedule(TIMER);
    expect(computeTransportGain(fadeStartSeconds - 1, TIMER).gain).toBe(1);
    expect(computeTransportGain(fadeStartSeconds, TIMER).gain).toBe(1);
  });

  it('ramps down across the fade-out window', () => {
    const { fadeStartSeconds } = computeFadeOutSchedule(TIMER);
    const midpoint = fadeStartSeconds + FADE_OUT_SECONDS / 2;
    expect(computeTransportGain(midpoint, TIMER).gain).toBeCloseTo(0.5);
  });

  it('reports complete at silence, and stays complete past the end', () => {
    expect(computeTransportGain(TIMER, TIMER)).toEqual({ complete: true, gain: 0 });
    expect(computeTransportGain(TIMER + 120, TIMER)).toEqual({ complete: true, gain: 0 });
  });

  it('is a pure function of elapsed time, so a late tick lands on the same gain', () => {
    const { fadeStartSeconds } = computeFadeOutSchedule(TIMER);
    const late = fadeStartSeconds + 21.7;

    // A 2 s throttled tick under lock skips the intermediate calls; the value it does
    // land on has to match what an uninterrupted ticker would have produced.
    expect(computeTransportGain(late, TIMER).gain).toBeCloseTo(
      computeTransportGain(late, TIMER).gain,
    );
    expect(computeTransportGain(late, TIMER).gain).toBeCloseTo(
      (FADE_OUT_SECONDS - 21.7) / FADE_OUT_SECONDS,
    );
  });

  it('never returns a gain above 1 or below 0', () => {
    for (const elapsed of [-5, 0, 1, TIMER - 1, TIMER, TIMER * 2]) {
      const { gain } = computeTransportGain(elapsed, TIMER);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });

  it('lets the fade-out win when a timer is shorter than the fade-in', () => {
    // Not reachable from the UI (the shortest timer is 15 min) but the envelope should
    // not exceed either ramp.
    const gain = computeTransportGain(1, 2, 4, 2).gain;
    expect(gain).toBeLessThanOrEqual(0.5);
  });
});

describe('computeTimerRebase', () => {
  const HOUR = 60 * 60;

  it('leaves the clock alone when the new timer still has more than a fade left', () => {
    expect(computeTimerRebase(60, HOUR)).toBeNull();
    expect(computeTimerRebase(0, 15 * 60)).toBeNull();
  });

  it('leaves the clock alone when the timer is switched off', () => {
    expect(computeTimerRebase(1000, 0)).toBeNull();
  });

  it('pulls the clock back to leave exactly one fade-out when the timer is cut short', () => {
    // 60 min timer at 1000 s elapsed, shortened to 15 min: already 100 s past the end.
    const rebased = computeTimerRebase(1000, 15 * 60);
    expect(rebased).toBe(15 * 60 - FADE_OUT_SECONDS);
  });

  it('produces an elapsed that starts the fade rather than completing the session', () => {
    const timer = 15 * 60;
    const rebased = computeTimerRebase(1000, timer);
    const envelope = computeTransportGain(rebased as number, timer);

    expect(envelope.complete).toBe(false);
    expect(envelope.gain).toBeCloseTo(1);
  });

  it('does not return a negative elapsed for a timer shorter than the fade', () => {
    expect(computeTimerRebase(100, 10, 30)).toBe(0);
  });
});

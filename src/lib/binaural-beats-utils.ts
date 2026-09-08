// Types
export type BinauralMode = 'binaural' | 'isochronic';
export type NoiseType = 'none' | 'pink' | 'brown';
export type Band = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

export interface BinauralPreset {
  beatHz: number;
  carrierHz: number;
  id: PresetId;
  label: string;
}

export interface EarFrequencies {
  left: number;
  right: number;
}

export interface FadeOutSchedule {
  /** Seconds after play at which the fade-out ramp begins. */
  fadeStartSeconds: number;
  /** Seconds after play at which the ramp reaches silence and playback stops. */
  fadeEndSeconds: number;
}

export interface NoiseBufferOptions {
  /** Samples of linear fade at each end so the loop seam does not click. */
  edgeFadeSamples?: number;
}

export interface TransportEnvelope {
  /** True once the timer has run past its fade-out and playback should stop. */
  complete: boolean;
  /** Gain in [0, 1], multiplied with the user's volume before it reaches the element. */
  gain: number;
}

// Constants
export const MODES = ['binaural', 'isochronic'] as const;
export const NOISE_TYPES = ['none', 'pink', 'brown'] as const;

export const BEAT_MIN = 0.5;
export const BEAT_MAX = 40;
export const CARRIER_MIN = 100;
export const CARRIER_MAX = 500;

export const TIMER_MINUTES_OPTIONS = [0, 15, 30, 45, 60, 90] as const;
export type TimerMinutes = (typeof TIMER_MINUTES_OPTIONS)[number];

export const FADE_IN_SECONDS = 3;
export const FADE_OUT_SECONDS = 30;

export const PRESET_IDS = ['sleep', 'deepRelax', 'calmFocus', 'focus', 'alert'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESETS: readonly BinauralPreset[] = [
  { beatHz: 2, carrierHz: 150, id: 'sleep', label: 'Sleep' },
  { beatHz: 6, carrierHz: 180, id: 'deepRelax', label: 'Deep relax' },
  { beatHz: 10, carrierHz: 200, id: 'calmFocus', label: 'Calm focus' },
  { beatHz: 16, carrierHz: 220, id: 'focus', label: 'Focus' },
  { beatHz: 40, carrierHz: 250, id: 'alert', label: 'Alert' },
];

export const BAND_LABELS: Record<Band, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};

export const DEFAULT_MODE: BinauralMode = 'binaural';
export const DEFAULT_BEAT_HZ = 10;
export const DEFAULT_CARRIER_HZ = 200;
export const DEFAULT_NOISE: NoiseType = 'none';
export const DEFAULT_NOISE_LEVEL = 0.3;
export const DEFAULT_VOLUME = 0.3;
export const DEFAULT_TIMER_MINUTES: TimerMinutes = 0;

const DEFAULT_EDGE_FADE_SAMPLES = 1024;

// Helper functions
export function clampBeat(value: number): number {
  return Math.max(BEAT_MIN, Math.min(BEAT_MAX, value));
}

export function clampCarrier(value: number): number {
  return Math.max(CARRIER_MIN, Math.min(CARRIER_MAX, value));
}

/**
 * Classify a beat frequency into the conventional brainwave band. Boundaries follow
 * the usual delta < 4 < theta < 8 < alpha < 13 < beta < 30 < gamma split.
 */
export function classifyBand(beatHz: number): Band {
  if (beatHz < 4) return 'delta';
  if (beatHz < 8) return 'theta';
  if (beatHz < 13) return 'alpha';
  if (beatHz < 30) return 'beta';
  return 'gamma';
}

/**
 * The active preset is derived, not stored: it is whichever preset exactly matches the
 * current beat and carrier, so any slider move away from those values deselects it.
 */
export function findMatchingPreset(beatHz: number, carrierHz: number): PresetId | null {
  const match = PRESETS.find(p => p.beatHz === beatHz && p.carrierHz === carrierHz);
  return match?.id ?? null;
}

/** Left ear hears the carrier; right ear hears carrier + beat, so the difference is the beat. */
export function getEarFrequencies(carrierHz: number, beatHz: number): EarFrequencies {
  return { left: carrierHz, right: carrierHz + beatHz };
}

/**
 * Where the timer fade-out sits relative to play. A timer shorter than the fade simply
 * fades from the start.
 */
export function computeFadeOutSchedule(
  timerDurationSeconds: number,
  fadeSeconds: number = FADE_OUT_SECONDS,
): FadeOutSchedule {
  return {
    fadeStartSeconds: Math.max(0, timerDurationSeconds - fadeSeconds),
    fadeEndSeconds: timerDurationSeconds,
  };
}

/**
 * The play/stop envelope, evaluated from wall-clock elapsed time rather than scheduled on
 * an audio clock. The rendered loop is steady-state and repeats forever, so neither fade
 * can live in the buffer; both ride on the media element's volume instead.
 *
 * iOS throttles timers to roughly 2 s while the screen is locked, so the ticker driving
 * this fires late and unevenly. Every call recomputes the gain from `elapsedSeconds`
 * instead of stepping a counter, which keeps a coarse tick from drifting the ramp.
 *
 * A `timerSeconds` of 0 means no timer: fade in, then hold at 1 indefinitely.
 */
export function computeTransportGain(
  elapsedSeconds: number,
  timerSeconds: number,
  fadeInSeconds: number = FADE_IN_SECONDS,
  fadeOutSeconds: number = FADE_OUT_SECONDS,
): TransportEnvelope {
  const fadeIn = fadeInSeconds > 0 ? Math.min(1, Math.max(0, elapsedSeconds / fadeInSeconds)) : 1;

  if (timerSeconds <= 0) {
    return { complete: false, gain: fadeIn };
  }

  const { fadeEndSeconds, fadeStartSeconds } = computeFadeOutSchedule(timerSeconds, fadeOutSeconds);

  if (elapsedSeconds >= fadeEndSeconds) {
    return { complete: true, gain: 0 };
  }

  const rampSeconds = fadeEndSeconds - fadeStartSeconds;
  const fadeOut =
    rampSeconds > 0 && elapsedSeconds > fadeStartSeconds
      ? (fadeEndSeconds - elapsedSeconds) / rampSeconds
      : 1;

  return { complete: false, gain: Math.min(fadeIn, fadeOut) };
}

/**
 * Where to move the elapsed clock to when the timer is changed mid-session, or null to
 * leave it alone.
 *
 * Shortening a timer past the elapsed time would otherwise complete the session on the
 * very next tick, cutting the audio at full volume on the one tool whose fade-out is the
 * whole point. Pulling the clock back to leave one fade's worth of room converts that into
 * an immediate fade-out instead.
 */
export function computeTimerRebase(
  elapsedSeconds: number,
  timerSeconds: number,
  fadeOutSeconds: number = FADE_OUT_SECONDS,
): number | null {
  if (timerSeconds <= 0) return null;

  const minimumRemaining = Math.min(fadeOutSeconds, timerSeconds);
  if (timerSeconds - elapsedSeconds >= minimumRemaining) return null;

  return Math.max(0, timerSeconds - minimumRemaining);
}

function finalizeNoise(samples: Float32Array, edgeFadeSamples: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const scale = peak > 0 ? 1 / peak : 1;

  const fade = Math.min(edgeFadeSamples, Math.floor(samples.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    let envelope = 1;
    if (i < fade) envelope = i / fade;
    else if (i >= samples.length - fade) envelope = (samples.length - 1 - i) / fade;
    samples[i] = samples[i] * scale * envelope;
  }

  return samples;
}

/**
 * Pink noise (equal energy per octave) via Paul Kellet's economy filter over white noise.
 * Output is peak-normalized to [-1, 1] with faded edges so it can loop seamlessly.
 */
export function generatePinkNoiseSamples(
  length: number,
  options: NoiseBufferOptions = {},
): Float32Array {
  const samples = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    samples[i] = b0 + b1 + b2 + white * 0.1848;
  }

  return finalizeNoise(samples, options.edgeFadeSamples ?? DEFAULT_EDGE_FADE_SAMPLES);
}

/**
 * Brown noise (energy falls 6 dB per octave) via a leaky integrator over white noise.
 * The leak keeps the random walk from drifting toward a DC extreme over a long buffer.
 */
export function generateBrownNoiseSamples(
  length: number,
  options: NoiseBufferOptions = {},
): Float32Array {
  const samples = new Float32Array(length);
  let last = 0;

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    samples[i] = last;
  }

  return finalizeNoise(samples, options.edgeFadeSamples ?? DEFAULT_EDGE_FADE_SAMPLES);
}

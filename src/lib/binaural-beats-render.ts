import {
  type BinauralMode,
  type NoiseBufferOptions,
  type NoiseType,
  generateBrownNoiseSamples,
  generatePinkNoiseSamples,
  getEarFrequencies,
} from '@/lib/binaural-beats-utils';

// Types
export interface RenderSettings {
  beatHz: number;
  carrierHz: number;
  mode: BinauralMode;
  noise: NoiseType;
  noiseLevel: number;
}

/**
 * The subset of `AudioBuffer` the WAV encoder reads. Declared structurally so the encoder
 * can be tested in the node env, which has no Web Audio.
 */
export interface PcmSource {
  getChannelData(channel: number): Float32Array;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
}

// Constants
/**
 * Length of the rendered loop. Any frequency that is an integer multiple of 1 / this
 * completes whole cycles inside the buffer and so crosses the loop seam without a phase
 * jump; see `snapToLoopGrid`. Longer also means the noise bed repeats less often, at the
 * cost of a slower re-render on every parameter change.
 */
export const LOOP_SECONDS = 30;

export const RENDER_SAMPLE_RATE = 44100;

/**
 * Headroom split between the tone and the noise bed. Their sum stays below 1 at full
 * noise level, so the mix cannot clip before it reaches the encoder.
 */
const TONE_GAIN = 0.45;
const NOISE_MAX_GAIN = 0.45;

/**
 * Overlap used to wrap the noise bed onto itself. Half a second is long enough that the
 * blend is inaudible on broadband noise and short enough to stay cheap.
 */
const NOISE_CROSSFADE_SAMPLES = 22050;

// Helper functions
/**
 * Snap a frequency onto the loop grid. A buffer of `loopSeconds` holds a whole number of
 * cycles only for multiples of 1 / `loopSeconds` Hz; anything else is mid-cycle at the
 * seam and clicks once per loop. At the default 30 s the grid is 1/30 Hz, which every
 * preset and the 0.5 Hz beat floor already sit on.
 */
export function snapToLoopGrid(hz: number, loopSeconds: number = LOOP_SECONDS): number {
  return Math.round(hz * loopSeconds) / loopSeconds;
}

/**
 * Where to resume after swapping the element's `src` for a freshly rendered loop, so a
 * parameter change picks up mid-loop instead of restarting the sound from the top.
 */
export function carryLoopPosition(
  previousTime: number,
  loopSeconds: number = LOOP_SECONDS,
): number {
  if (!Number.isFinite(previousTime) || previousTime <= 0 || loopSeconds <= 0) return 0;
  return previousTime % loopSeconds;
}

/**
 * Minimal 16-bit PCM WAV encoder, so a rendered buffer can be handed to an `<audio>`
 * element without pulling in a library. Returns the bytes; `encodeWav` wraps them in a
 * Blob.
 */
export function encodeWavBytes(buffer: PcmSource): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  let cursor = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      view.setInt16(cursor, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      cursor += 2;
    }
  }

  return out;
}

export function encodeWav(buffer: PcmSource): Blob {
  return new Blob([encodeWavBytes(buffer)], { type: 'audio/wav' });
}

/**
 * Noise that wraps onto itself without a seam and without a gap.
 *
 * The generators' own edge fade solves the seam by ramping both ends to silence, which is
 * right for a buffer played once but wrong here: this bed loops every `LOOP_SECONDS`, so
 * the two ramps meet and become a recurring dropout, around 120 of them an hour on a sleep
 * session. Instead the noise is generated `crossfadeSamples` longer than needed with the
 * edge fade off, and the surplus tail is blended back over the head. Sample `length - 1`
 * then runs into sample 0 as an ordinary step, because sample 0 is the continuation of the
 * source stream that produced it.
 */
export function generateLoopableNoise(
  generate: (length: number, options?: NoiseBufferOptions) => Float32Array,
  length: number,
  crossfadeSamples: number = NOISE_CROSSFADE_SAMPLES,
): Float32Array {
  const overlap = Math.max(0, Math.min(crossfadeSamples, Math.floor(length / 2)));
  const raw = generate(length + overlap, { edgeFadeSamples: 0 });
  const out = raw.slice(0, length);

  for (let i = 0; i < overlap; i += 1) {
    const t = i / overlap;
    out[i] = raw[i] * t + raw[length + i] * (1 - t);
  }

  return out;
}

// Shared graph
/**
 * Handles onto a built graph so a live engine can retune it in place rather than tearing it
 * down and rebuilding, which would restart the sound on every slider move. The offline
 * renderer builds the same graph and simply ignores the handle.
 */
export interface SessionGraphHandle {
  /** Stop and disconnect every source the graph started. */
  dispose(): void;
  /** Retune carrier and beat without rebuilding, so a drag stays click-free. */
  setFrequencies(carrierHz: number, beatHz: number): void;
  /** Set the bed level without regenerating its buffer. */
  setNoiseLevel(level: number): void;
}

interface GraphOptions {
  /** Seconds of noise generated before the bed loops. The bed always loops. */
  noiseSeconds: number;
  /**
   * Loop length to snap tone frequencies onto, or null to leave them exact. Snapping only
   * matters when the graph is rendered into a buffer that will loop; live oscillators run
   * continuously and never cross a seam.
   */
  snapSeconds: number | null;
}

interface ToneSection {
  setFrequencies(carrierHz: number, beatHz: number): void;
  sources: AudioScheduledSourceNode[];
}

interface NoiseSection {
  setNoiseLevel(level: number): void;
  sources: AudioScheduledSourceNode[];
}

/**
 * Apply the loop grid, or don't. This is the whole difference between the engines at the
 * graph level: the sleep engine renders a buffer that will loop, so its tones must complete
 * whole cycles inside it, while the focus engine's oscillators run continuously and are
 * left at exactly the requested frequency.
 */
export function gridSnap(hz: number, snapSeconds: number | null): number {
  return snapSeconds === null ? hz : snapToLoopGrid(hz, snapSeconds);
}

/** Left ear gets the carrier, right ear the carrier plus the beat, hard-panned. */
function connectBinauralTones(
  context: BaseAudioContext,
  settings: RenderSettings,
  destination: AudioNode,
  snapSeconds: number | null,
): ToneSection {
  const ears = getEarFrequencies(
    gridSnap(settings.carrierHz, snapSeconds),
    gridSnap(settings.beatHz, snapSeconds),
  );

  const merger = context.createChannelMerger(2);
  merger.connect(destination);

  const oscillators: OscillatorNode[] = [];
  [ears.left, ears.right].forEach((frequency, channel) => {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const gain = context.createGain();
    gain.gain.value = TONE_GAIN;

    oscillator.connect(gain);
    gain.connect(merger, 0, channel);
    oscillator.start();
    oscillators.push(oscillator);
  });

  return {
    setFrequencies(carrierHz, beatHz) {
      const next = getEarFrequencies(
        gridSnap(carrierHz, snapSeconds),
        gridSnap(beatHz, snapSeconds),
      );
      oscillators[0].frequency.value = next.left;
      oscillators[1].frequency.value = next.right;
    },
    sources: oscillators,
  };
}

/**
 * Speaker mode: one carrier in both ears, gated on and off at the beat rate. Binaural
 * beating needs headphones to work at all, so this is the fallback that still pulses
 * audibly over a speaker.
 */
function connectIsochronicTone(
  context: BaseAudioContext,
  settings: RenderSettings,
  destination: AudioNode,
  snapSeconds: number | null,
): ToneSection {
  const carrierHz = gridSnap(settings.carrierHz, snapSeconds);
  const beatHz = gridSnap(settings.beatHz, snapSeconds);

  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = carrierHz;

  // Pulse gain swings across the full 0..1 range: a sine LFO scaled to +/-0.5 summed with
  // a constant 0.5, so the carrier is gated rather than merely wobbled in level.
  const pulse = context.createGain();
  pulse.gain.value = 0;

  const lfo = context.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = beatHz;

  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 0.5;

  const offset = context.createConstantSource();
  offset.offset.value = 0.5;

  lfo.connect(lfoDepth);
  lfoDepth.connect(pulse.gain);
  offset.connect(pulse.gain);

  const level = context.createGain();
  level.gain.value = TONE_GAIN;

  oscillator.connect(pulse);
  pulse.connect(level);
  level.connect(destination);

  oscillator.start();
  lfo.start();
  offset.start();

  return {
    setFrequencies(carrierHz, beatHz) {
      oscillator.frequency.value = gridSnap(carrierHz, snapSeconds);
      lfo.frequency.value = gridSnap(beatHz, snapSeconds);
    },
    sources: [oscillator, lfo, offset],
  };
}

/**
 * Independent noise per channel. Decorrelated noise sits outside the head rather than
 * centred in it, and each channel is wrapped onto itself by `generateLoopableNoise` so the
 * bed crosses the loop seam continuously rather than dipping to silence there.
 */
function connectNoise(
  context: BaseAudioContext,
  settings: RenderSettings,
  destination: AudioNode,
  noiseSeconds: number,
): NoiseSection {
  // Turning the bed on later needs a buffer that does not exist yet, so the caller rebuilds
  // the graph on a noise *type* change; only the level is adjustable in place.
  if (settings.noise === 'none' || settings.noiseLevel <= 0) {
    return { setNoiseLevel: () => undefined, sources: [] };
  }

  const generate = settings.noise === 'pink' ? generatePinkNoiseSamples : generateBrownNoiseSamples;
  const length = Math.round(noiseSeconds * context.sampleRate);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  // `set` rather than `copyToChannel`: the generators return a plain Float32Array, whose
  // buffer type does not narrow to the `Float32Array<ArrayBuffer>` copyToChannel wants.
  buffer.getChannelData(0).set(generateLoopableNoise(generate, length));
  buffer.getChannelData(1).set(generateLoopableNoise(generate, length));

  const source = context.createBufferSource();
  source.buffer = buffer;
  // Required live, where the bed would otherwise play once and stop. Harmless offline: the
  // render is exactly one buffer long, so it never reaches the wrap.
  source.loop = true;

  const gain = context.createGain();
  gain.gain.value = settings.noiseLevel * NOISE_MAX_GAIN;

  source.connect(gain);
  gain.connect(destination);
  source.start();

  return {
    setNoiseLevel(level) {
      gain.gain.value = level * NOISE_MAX_GAIN;
    },
    sources: [source],
  };
}

/**
 * Build the session graph onto any context. Both engines share this: the sleep engine
 * renders it offline into a looping buffer, the focus engine runs it live. Fades are
 * deliberately absent - offline they would repeat on every loop pass, and live they belong
 * on the master gain - so both engines apply the transport envelope downstream.
 */
export function connectSessionGraph(
  context: BaseAudioContext,
  settings: RenderSettings,
  destination: AudioNode,
  options: GraphOptions,
): SessionGraphHandle {
  const tones =
    settings.mode === 'binaural'
      ? connectBinauralTones(context, settings, destination, options.snapSeconds)
      : connectIsochronicTone(context, settings, destination, options.snapSeconds);

  const noise = connectNoise(context, settings, destination, options.noiseSeconds);

  return {
    dispose() {
      for (const source of [...tones.sources, ...noise.sources]) {
        try {
          source.stop();
        } catch {
          // Already stopped, or never started; disconnecting is what matters.
        }
        source.disconnect();
      }
    },
    setFrequencies: tones.setFrequencies,
    setNoiseLevel: noise.setNoiseLevel,
  };
}

/**
 * Render one seamless loop of the current settings, for the sleep engine. Tone frequencies
 * are snapped onto the loop grid here because this buffer *will* loop; the focus engine
 * passes `snapSeconds: null` since its oscillators run continuously.
 */
export async function renderSessionBuffer(
  settings: RenderSettings,
  loopSeconds: number = LOOP_SECONDS,
): Promise<AudioBuffer> {
  const frames = Math.round(loopSeconds * RENDER_SAMPLE_RATE);
  const context = new OfflineAudioContext(2, frames, RENDER_SAMPLE_RATE);

  connectSessionGraph(context, settings, context.destination, {
    noiseSeconds: loopSeconds,
    snapSeconds: loopSeconds,
  });

  return context.startRendering();
}

/** Render and wrap as an object URL. The caller owns revoking it. */
export async function renderSessionUrl(
  settings: RenderSettings,
  loopSeconds: number = LOOP_SECONDS,
): Promise<string> {
  const buffer = await renderSessionBuffer(settings, loopSeconds);
  return URL.createObjectURL(encodeWav(buffer));
}

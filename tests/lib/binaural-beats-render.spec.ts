import { describe, expect, it } from 'vitest';

import {
  type PcmSource,
  type RenderSettings,
  LOOP_SECONDS,
  carryLoopPosition,
  connectSessionGraph,
  encodeWavBytes,
  generateLoopableNoise,
  gridSnap,
  snapToLoopGrid,
} from '@/lib/binaural-beats-render';
import {
  BEAT_MIN,
  PRESETS,
  generateBrownNoiseSamples,
  generatePinkNoiseSamples,
} from '@/lib/binaural-beats-utils';

function stubBuffer(channels: Float32Array[], sampleRate = 44100): PcmSource {
  return {
    getChannelData: channel => channels[channel],
    length: channels[0].length,
    numberOfChannels: channels.length,
    sampleRate,
  };
}

function readString(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe('snapToLoopGrid', () => {
  it('leaves frequencies that already complete whole cycles in the buffer untouched', () => {
    expect(snapToLoopGrid(200, 30)).toBe(200);
    expect(snapToLoopGrid(0.5, 30)).toBe(0.5);
    expect(snapToLoopGrid(10.3, 30)).toBeCloseTo(10.3, 10);
  });

  it('snaps an off-grid frequency onto the nearest multiple of 1 / loopSeconds', () => {
    // 1/30 Hz grid: 10.33 * 30 = 309.9, so it lands on 310/30.
    expect(snapToLoopGrid(10.33, 30)).toBeCloseTo(310 / 30, 10);
    // 10.31 * 30 = 309.3, which rounds the other way.
    expect(snapToLoopGrid(10.31, 30)).toBeCloseTo(309 / 30, 10);
  });

  it('produces a whole number of cycles per loop for every preset, in both ears', () => {
    for (const preset of PRESETS) {
      const carrier = snapToLoopGrid(preset.carrierHz, LOOP_SECONDS);
      const beat = snapToLoopGrid(preset.beatHz, LOOP_SECONDS);

      expect(carrier * LOOP_SECONDS).toBeCloseTo(Math.round(carrier * LOOP_SECONDS), 6);
      expect((carrier + beat) * LOOP_SECONDS).toBeCloseTo(
        Math.round((carrier + beat) * LOOP_SECONDS),
        6,
      );
    }
  });

  it('keeps the beat floor on the grid', () => {
    expect(snapToLoopGrid(BEAT_MIN, LOOP_SECONDS)).toBe(BEAT_MIN);
  });

  it('uses a coarser grid for a shorter loop', () => {
    // At 2 s the grid is 0.5 Hz, so 10.3 cannot survive.
    expect(snapToLoopGrid(10.3, 2)).toBe(10.5);
  });
});

describe('gridSnap', () => {
  // The null branch is the whole difference between the engines at the graph level: the
  // focus engine's oscillators run continuously, so nothing quantizes their frequency.
  it('leaves frequencies exact when there is no grid', () => {
    expect(gridSnap(10.33, null)).toBe(10.33);
    expect(gridSnap(200.7, null)).toBe(200.7);
    expect(gridSnap(BEAT_MIN, null)).toBe(BEAT_MIN);
  });

  it('applies the loop grid when given one, matching what the sleep engine renders', () => {
    expect(gridSnap(10.33, 30)).toBe(snapToLoopGrid(10.33, 30));
    expect(gridSnap(10.3, 2)).toBe(10.5);
  });
});

describe('carryLoopPosition', () => {
  it('keeps a position that is already inside the loop', () => {
    expect(carryLoopPosition(12.5, 30)).toBeCloseTo(12.5);
  });

  it('wraps a position past the end of a shorter loop', () => {
    expect(carryLoopPosition(35, 30)).toBeCloseTo(5);
  });

  it('starts from the top for a fresh or unusable position', () => {
    expect(carryLoopPosition(0, 30)).toBe(0);
    expect(carryLoopPosition(-1, 30)).toBe(0);
    expect(carryLoopPosition(Number.NaN, 30)).toBe(0);
    expect(carryLoopPosition(10, 0)).toBe(0);
  });
});

describe('generateLoopableNoise', () => {
  const LENGTH = 20000;
  const OVERLAP = 2000;

  function maxStep(samples: Float32Array): number {
    let max = 0;
    for (let i = 1; i < samples.length; i += 1) {
      max = Math.max(max, Math.abs(samples[i] - samples[i - 1]));
    }
    return max;
  }

  for (const [name, generate] of [
    ['pink', generatePinkNoiseSamples],
    ['brown', generateBrownNoiseSamples],
  ] as const) {
    describe(name, () => {
      it('returns exactly the requested length', () => {
        expect(generateLoopableNoise(generate, LENGTH, OVERLAP).length).toBe(LENGTH);
      });

      it('does not fade its edges to silence, unlike the raw generator', () => {
        const looped = generateLoopableNoise(generate, LENGTH, OVERLAP);
        const raw = generate(LENGTH);

        // The raw generator ramps both ends to zero; that is the dropout this replaces.
        expect(Math.abs(raw[0])).toBeCloseTo(0, 6);
        expect(Math.abs(raw[LENGTH - 1])).toBeCloseTo(0, 6);

        // Both ends, not the louder of the two: a fade at either end is a dropout.
        expect(Math.abs(looped[0])).toBeGreaterThan(0.001);
        expect(Math.abs(looped[LENGTH - 1])).toBeGreaterThan(0.001);
      });

      it('wraps continuously, so the loop point is an ordinary step', () => {
        const looped = generateLoopableNoise(generate, LENGTH, OVERLAP);
        const seamStep = Math.abs(looped[0] - looped[LENGTH - 1]);

        // Sample 0 is the source stream's continuation of sample length-1, so crossing the
        // loop point must cost no more than the largest step found anywhere inside it.
        expect(seamStep).toBeLessThanOrEqual(maxStep(looped));
      });

      it('stays within the normalized range', () => {
        for (const sample of generateLoopableNoise(generate, LENGTH, OVERLAP)) {
          expect(Math.abs(sample)).toBeLessThanOrEqual(1);
        }
      });
    });
  }

  it('caps the overlap at half the buffer', () => {
    const tiny = generateLoopableNoise(generatePinkNoiseSamples, 100, 10_000);
    expect(tiny.length).toBe(100);
  });

  it('is a plain unfaded buffer when the overlap is zero', () => {
    const none = generateLoopableNoise(generatePinkNoiseSamples, 1000, 0);
    expect(none.length).toBe(1000);
    expect(Math.abs(none[0])).toBeGreaterThan(0);
  });
});

describe('encodeWavBytes', () => {
  it('writes a 44-byte header describing the buffer', () => {
    const frames = 8;
    const buffer = stubBuffer([new Float32Array(frames), new Float32Array(frames)], 44100);
    const view = new DataView(encodeWavBytes(buffer));

    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(readString(view, 8, 4)).toBe('WAVE');
    expect(readString(view, 12, 4)).toBe('fmt ');
    expect(readString(view, 36, 4)).toBe('data');

    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
  });

  it('sizes the output for 16-bit stereo frames', () => {
    const frames = 100;
    const bytes = encodeWavBytes(stubBuffer([new Float32Array(frames), new Float32Array(frames)]));

    expect(bytes.byteLength).toBe(44 + frames * 2 * 2);
    expect(new DataView(bytes).getUint32(40, true)).toBe(frames * 2 * 2);
  });

  it('interleaves channels frame by frame', () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1]);
    const view = new DataView(encodeWavBytes(stubBuffer([left, right])));

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0x7fff);
    expect(view.getInt16(50, true)).toBe(-0x8000);
  });

  it('clamps samples outside [-1, 1] instead of wrapping them', () => {
    const view = new DataView(encodeWavBytes(stubBuffer([Float32Array.from([4, -4])])));

    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('round-trips silence as zeroes', () => {
    const view = new DataView(encodeWavBytes(stubBuffer([new Float32Array(4)])));

    for (let i = 0; i < 4; i += 1) expect(view.getInt16(44 + i * 2, true)).toBe(0);
  });
});

/**
 * The suite runs in the node env, which has no Web Audio, so the graph builder is exercised
 * against a stub that records the gain nodes it hands out. Enough to pin wiring decisions -
 * what got built, and whether a setter reaches a real node - without asserting on sound.
 */
function stubContext(sampleRate = 44100) {
  const gains: { disconnected: boolean; gain: { value: number } }[] = [];
  const bufferSources: unknown[] = [];
  const wiring = { connect: () => undefined, disconnect: () => undefined };

  const context = {
    sampleRate,
    createChannelMerger: () => ({ ...wiring }),
    createGain: () => {
      const node = {
        connect: () => undefined,
        disconnect: () => {
          node.disconnected = true;
        },
        disconnected: false,
        // A real createGain opens at unity; the builders overwrite it where they care.
        gain: { value: 1 },
      };
      gains.push(node);
      return node;
    },
    createOscillator: () => ({
      ...wiring,
      frequency: { value: 0 },
      start: () => undefined,
      stop: () => undefined,
      type: 'sine',
    }),
    createConstantSource: () => ({
      ...wiring,
      offset: { value: 0 },
      start: () => undefined,
      stop: () => undefined,
    }),
    createBufferSource: () => {
      const node = {
        ...wiring,
        buffer: null,
        loop: false,
        start: () => undefined,
        stop: () => undefined,
      };
      bufferSources.push(node);
      return node;
    },
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };

  return {
    // The handle exposes only dispose/setFrequencies/setNoiseLevel, so "was a bed built?"
    // is asked of the context rather than the return value.
    bufferSources,
    context: context as unknown as BaseAudioContext,
    destination: { ...wiring } as unknown as AudioNode,
    // The group gain is built first, before either section.
    groupGain: () => gains[0],
    // The noise gain is the last one built: tones create theirs first.
    noiseGain: () => gains[gains.length - 1],
  };
}

const BASE_SETTINGS: RenderSettings = {
  beatHz: 6,
  carrierHz: 200,
  mode: 'binaural',
  noise: 'pink',
  noiseLevel: 0.5,
};

describe('connectSessionGraph', () => {
  const options = { noiseSeconds: 0.05, snapSeconds: null };

  it('builds the noise bed even when the level starts at 0, so it can be raised later', () => {
    // The regression: short-circuiting a 0 level returned a no-op `setNoiseLevel`, which was
    // baked in for the life of the graph. Reachable from the slider's min and from
    // `?noise=pink&noiseLevel=0`.
    const { bufferSources, context, destination, noiseGain } = stubContext();

    const graph = connectSessionGraph(
      context,
      { ...BASE_SETTINGS, noiseLevel: 0 },
      destination,
      options,
    );

    expect(bufferSources).toHaveLength(1);
    expect(noiseGain().gain.value).toBe(0);

    graph.setNoiseLevel(0.6);
    expect(noiseGain().gain.value).toBeGreaterThan(0);
  });

  it('leaves the bed unbuilt when the noise type is none', () => {
    const { bufferSources, context, destination } = stubContext();

    const graph = connectSessionGraph(
      context,
      { ...BASE_SETTINGS, noise: 'none' },
      destination,
      options,
    );

    expect(bufferSources).toHaveLength(0);
    expect(() => graph.setNoiseLevel(0.6)).not.toThrow();
  });

  it('detaches the whole graph on dispose, not just the sources', () => {
    // Stopping the sources left the mergers and section gains attached to the destination for
    // the life of the context, and the focus engine rebuilds on every mode or noise change.
    const { context, destination, groupGain } = stubContext();

    const graph = connectSessionGraph(context, BASE_SETTINGS, destination, options);
    expect(groupGain().disconnected).toBe(false);

    graph.dispose();
    expect(groupGain().disconnected).toBe(true);
  });

  it('opens the bed at the level it was given', () => {
    const { context, destination, noiseGain } = stubContext();

    connectSessionGraph(context, BASE_SETTINGS, destination, options);

    expect(noiseGain().gain.value).toBeGreaterThan(0);
  });
});

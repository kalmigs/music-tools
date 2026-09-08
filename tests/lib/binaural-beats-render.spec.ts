import { describe, expect, it } from 'vitest';

import {
  type PcmSource,
  LOOP_SECONDS,
  carryLoopPosition,
  encodeWavBytes,
  snapToLoopGrid,
} from '@/lib/binaural-beats-render';
import { BEAT_MIN, PRESETS } from '@/lib/binaural-beats-utils';

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

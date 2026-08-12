import { describe, expect, it } from 'vitest';

import {
  advanceSpeedTrainer,
  clampBpm,
  type SpeedTrainerConfig,
  type SpeedTrainerState,
} from '@/hooks/use-metronome';

const config: SpeedTrainerConfig = {
  bpmIncrement: 10,
  enabled: true,
  loops: 3,
  repeatsPerLoop: 2,
};

const state: SpeedTrainerState = { currentBpm: 120, currentLoop: 1, currentRepeat: 1 };

describe('clampBpm', () => {
  it('passes through in-range values', () => {
    expect(clampBpm(120)).toBe(120);
  });

  it('clamps to the supported range', () => {
    expect(clampBpm(5)).toBe(20);
    expect(clampBpm(9999)).toBe(300);
  });
});

describe('advanceSpeedTrainer', () => {
  it('holds inside a loop, counting repeats without touching bpm', () => {
    const result = advanceSpeedTrainer(state, config);

    expect(result).toEqual({
      kind: 'hold',
      state: { currentBpm: 120, currentLoop: 1, currentRepeat: 2 },
    });
  });

  it('steps up bpm and resets the repeat counter when a loop completes', () => {
    const result = advanceSpeedTrainer({ ...state, currentRepeat: 2 }, config);

    expect(result).toEqual({
      kind: 'advance',
      state: { currentBpm: 130, currentLoop: 2, currentRepeat: 1 },
    });
  });

  it('reports completion once the configured loop count is exhausted', () => {
    const result = advanceSpeedTrainer({ ...state, currentLoop: 3, currentRepeat: 2 }, config);

    expect(result).toEqual({ kind: 'complete' });
  });

  it('never completes when loops is 0 (run forever)', () => {
    const result = advanceSpeedTrainer(
      { ...state, currentLoop: 999, currentRepeat: 2 },
      { ...config, loops: 0 },
    );

    expect(result.kind).toBe('advance');
  });

  it('clamps the stepped-up bpm to the maximum', () => {
    const result = advanceSpeedTrainer(
      { currentBpm: 295, currentLoop: 1, currentRepeat: 2 },
      { ...config, loops: 0 },
    );

    expect(result).toEqual({
      kind: 'advance',
      state: { currentBpm: 300, currentLoop: 2, currentRepeat: 1 },
    });
  });

  it('does not mutate the state it is given', () => {
    const input: SpeedTrainerState = { currentBpm: 120, currentLoop: 1, currentRepeat: 2 };
    advanceSpeedTrainer(input, config);

    expect(input).toEqual({ currentBpm: 120, currentLoop: 1, currentRepeat: 2 });
  });

  it('walks a full 2-repeat, 2-loop run to completion', () => {
    const run: SpeedTrainerConfig = { ...config, loops: 2, repeatsPerLoop: 2 };
    const seen: SpeedTrainerAdvanceLog[] = [];
    let current: SpeedTrainerState = { currentBpm: 100, currentLoop: 1, currentRepeat: 1 };

    for (let measure = 0; measure < 5; measure++) {
      const result = advanceSpeedTrainer(current, run);
      if (result.kind === 'complete') {
        seen.push({ kind: 'complete' });
        break;
      }
      current = result.state;
      seen.push({ kind: result.kind, bpm: current.currentBpm, loop: current.currentLoop });
    }

    expect(seen).toEqual([
      { kind: 'hold', bpm: 100, loop: 1 },
      { kind: 'advance', bpm: 110, loop: 2 },
      { kind: 'hold', bpm: 110, loop: 2 },
      { kind: 'complete' },
    ]);
  });
});

type SpeedTrainerAdvanceLog =
  { kind: 'complete' } | { kind: 'advance' | 'hold'; bpm: number; loop: number };

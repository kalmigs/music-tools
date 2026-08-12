import { describe, expect, it } from 'vitest';

import {
  SHIMMER_SEMITONES,
  chordToMidi,
  computeVoicingNotes,
  getDiatonicChords,
  rootMidi,
} from '@/lib/worship-pad-utils';

describe('getDiatonicChords', () => {
  it('builds major diatonic chords in C', () => {
    const chords = getDiatonicChords('C', 'major');
    expect(chords.map(c => c.name)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect(chords.map(c => c.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(chords.map(c => c.quality)).toEqual(['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']);
  });

  it('builds natural minor diatonic chords in A', () => {
    const chords = getDiatonicChords('A', 'minor');
    expect(chords.map(c => c.name)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
    expect(chords.map(c => c.roman)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
  });

  it('wraps pitch classes past B', () => {
    const chords = getDiatonicChords('G', 'major');
    expect(chords[3].name).toBe('C');
    expect(chords[4].name).toBe('D');
  });
});

describe('chordToMidi', () => {
  const [c, , , , g] = getDiatonicChords('C', 'major');

  it('returns C major triad in octave 3', () => {
    expect(chordToMidi(c, 3, 'triad')).toEqual([48, 52, 55]);
  });

  it('replaces the 3rd with a 4th for sus4', () => {
    expect(chordToMidi(c, 3, 'sus4')).toEqual([48, 53, 55]);
  });

  it('appends the 9th for add9', () => {
    expect(chordToMidi(c, 3, 'add9')).toEqual([48, 52, 55, 62]);
  });

  it('handles minor triads (Bdim as dim)', () => {
    const bdim = getDiatonicChords('C', 'major')[6];
    expect(chordToMidi(bdim, 3, 'triad')).toEqual([59, 62, 65]);
  });

  it('respects octave placement for V', () => {
    expect(chordToMidi(g, 2, 'triad')).toEqual([43, 47, 50]);
  });

  it('prepends root-12 when subRoot is enabled', () => {
    expect(chordToMidi(c, 3, 'triad', true)).toEqual([36, 48, 52, 55]);
    expect(chordToMidi(c, 3, 'sus4', true)).toEqual([36, 48, 53, 55]);
    expect(chordToMidi(c, 3, 'add9', true)).toEqual([36, 48, 52, 55, 62]);
  });
});

describe('rootMidi', () => {
  it('maps pitch class + octave to MIDI number (C4 = 60)', () => {
    expect(rootMidi(0, 4)).toBe(60);
    expect(rootMidi(9, 4)).toBe(69);
  });
});

describe('computeVoicingNotes', () => {
  const c = getDiatonicChords('C', 'major')[0];

  it('returns the plain chord with no shimmer and no sub-root', () => {
    expect(computeVoicingNotes(c, 'triad', 3, false, false, false)).toEqual({
      midi: [48, 52, 55],
      shimmerMidi: [],
    });
  });

  it('adds the sub-root when Sub is on and the drone is off', () => {
    expect(computeVoicingNotes(c, 'triad', 3, true, false, false).midi).toEqual([36, 48, 52, 55]);
  });

  // The bass level should stay constant whether Sub, Drone, or both are on.
  it('drops the sub-root when the drone already covers it', () => {
    expect(computeVoicingNotes(c, 'triad', 3, true, false, true).midi).toEqual([48, 52, 55]);
  });

  it('leaves the chord alone when the drone is on but Sub is off', () => {
    expect(computeVoicingNotes(c, 'triad', 3, false, false, true).midi).toEqual([48, 52, 55]);
  });

  it('doubles every sounded note two octaves up for shimmer', () => {
    const { midi, shimmerMidi } = computeVoicingNotes(c, 'triad', 3, false, true, false);

    expect(shimmerMidi).toEqual(midi.map(n => n + SHIMMER_SEMITONES));
    expect(shimmerMidi).toEqual([72, 76, 79]);
  });

  it('shimmers the sub-root too when it is part of the voicing', () => {
    const { midi, shimmerMidi } = computeVoicingNotes(c, 'triad', 3, true, true, false);

    expect(midi).toEqual([36, 48, 52, 55]);
    expect(shimmerMidi).toEqual([60, 72, 76, 79]);
  });

  it('carries the variant through to the voicing', () => {
    expect(computeVoicingNotes(c, 'sus4', 3, false, false, false).midi).toEqual([48, 53, 55]);
    expect(computeVoicingNotes(c, 'add9', 3, false, false, false).midi).toEqual([48, 52, 55, 62]);
  });
});

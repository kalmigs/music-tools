import { useCallback, useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { Headphones, Loader2, Play, Square } from 'lucide-react';

import { useBinauralBeats } from '@/hooks/use-binaural-beats';
import { useRegisterShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { searchSchema, type SearchParams } from '@/lib/binaural-beats-search';
import {
  BAND_LABELS,
  BEAT_MAX,
  BEAT_MIN,
  CARRIER_MAX,
  CARRIER_MIN,
  DEFAULT_BEAT_HZ,
  DEFAULT_CARRIER_HZ,
  DEFAULT_MODE,
  DEFAULT_NOISE,
  DEFAULT_NOISE_LEVEL,
  DEFAULT_TIMER_MINUTES,
  DEFAULT_VOLUME,
  MODES,
  NOISE_TYPES,
  PRESETS,
  TIMER_MINUTES_OPTIONS,
  type TimerMinutes,
  classifyBand,
  clampBeat,
  clampCarrier,
  findMatchingPreset,
  getEarFrequencies,
} from '@/lib/binaural-beats-utils';
import { isTypingTarget } from '@/lib/keyboard-utils';
import { cn } from '@/lib/utils';

// Constants
/** Half a hertz keeps the beat on the 30 s loop grid; see `snapToLoopGrid`. */
const BEAT_STEP = 0.5;
const CARRIER_STEP = 1;
const VOLUME_STEP = 0.05;

const MODE_LABELS = { binaural: 'Binaural', isochronic: 'Speaker' } as const;
const NOISE_LABELS = { none: 'None', pink: 'Pink', brown: 'Brown' } as const;

// Helpers
function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Subcomponents
interface SegmentedProps<T extends string | number> {
  labels?: Partial<Record<string, string>>;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}

function Segmented<T extends string | number>({
  labels,
  onChange,
  options,
  value,
}: SegmentedProps<T>) {
  return (
    <div className="inline-flex rounded-xl border border-border/70 bg-background/60 p-1">
      {options.map(opt => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labels?.[String(opt)] ?? String(opt)}
        </button>
      ))}
    </div>
  );
}

interface SliderRowProps {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
  valueLabel: string;
}

function SliderRow({ label, max, min, onChange, step, value, valueLabel }: SliderRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-sm text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
      <span className="w-16 text-right text-sm font-medium tabular-nums">{valueLabel}</span>
    </div>
  );
}

// Main component
function BinauralBeatsPage() {
  const navigate = useNavigate({ from: '/binaural-beats' });
  const search = Route.useSearch();

  const beat = search.beat ?? DEFAULT_BEAT_HZ;
  const carrier = search.carrier ?? DEFAULT_CARRIER_HZ;
  const mode = search.mode ?? DEFAULT_MODE;
  const noise = search.noise ?? DEFAULT_NOISE;
  const noiseLevel = search.noiseLevel ?? DEFAULT_NOISE_LEVEL;
  const timer = search.timer ?? DEFAULT_TIMER_MINUTES;
  const volume = search.volume ?? DEFAULT_VOLUME;

  const updateSearch = useCallback(
    (updates: Partial<SearchParams>) => {
      navigate({ search: prev => ({ ...prev, ...updates }), replace: true });
    },
    [navigate],
  );

  const { elapsedSeconds, isPlaying, isRendering, toggle } = useBinauralBeats({
    beatHz: beat,
    carrierHz: carrier,
    mode,
    noise,
    noiseLevel,
    timerMinutes: timer,
    volume,
  });

  const ears = getEarFrequencies(carrier, beat);
  const activePreset = findMatchingPreset(beat, carrier);
  const timerSeconds = timer * 60;

  const nudgeBeat = useCallback(
    (delta: number) => updateSearch({ beat: clampBeat(beat + delta) }),
    [beat, updateSearch],
  );

  useRegisterShortcuts([
    { key: 'Space', label: 'Start / Stop' },
    { key: '←/→', label: 'Nudge beat frequency' },
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        // Holding Space would otherwise toggle at the key-repeat rate, tearing down and
        // restarting the media element each time. Arrow repeat is left alone: holding one
        // to sweep the beat frequency is useful.
        if (e.repeat) return;
        toggle();
        return;
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        nudgeBeat(-BEAT_STEP);
        return;
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        nudgeBeat(BEAT_STEP);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nudgeBeat, toggle]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-b from-card via-card to-background p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -top-20 right-10 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground/90">
              <Headphones className="size-4 text-primary" />
              Binaural Beats
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {beat.toFixed(1)} Hz <span className="text-muted-foreground">·</span>{' '}
              {BAND_LABELS[classifyBand(beat)]}
            </h1>
            <p className="text-sm tabular-nums text-muted-foreground">
              {mode === 'binaural'
                ? `${ears.left.toFixed(1)} Hz left · ${ears.right.toFixed(1)} Hz right`
                : `${carrier.toFixed(0)} Hz pulsed ${beat.toFixed(1)} times a second`}
            </p>
          </div>
          <Segmented
            options={MODES}
            labels={MODE_LABELS}
            value={mode}
            onChange={next => updateSearch({ mode: next })}
          />
        </div>

        <div className="relative mt-4 flex flex-wrap gap-2">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => updateSearch({ beat: preset.beatHz, carrier: preset.carrierHz })}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors',
                activePreset === preset.id
                  ? 'border-primary/60 bg-primary/15 text-foreground ring-2 ring-primary/50'
                  : 'border-border/70 bg-card text-muted-foreground hover:bg-accent/60',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center gap-3 rounded-3xl border border-border/80 bg-card p-6 shadow-sm">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex size-24 items-center justify-center rounded-full border shadow-sm transition-all active:scale-[0.97]',
            isPlaying
              ? 'border-primary/60 bg-primary/15 ring-2 ring-primary/50'
              : 'border-border/70 bg-background hover:bg-accent/60',
          )}
          aria-label={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? (
            <Square className="size-8 text-primary" />
          ) : (
            <Play className="size-8 translate-x-0.5 text-primary" />
          )}
        </button>

        <p className="text-sm tabular-nums text-muted-foreground">
          {timerSeconds > 0
            ? `${formatClock(elapsedSeconds)} / ${formatClock(timerSeconds)}`
            : formatClock(elapsedSeconds)}
        </p>

        {isRendering && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Rendering loop
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
        <SliderRow
          label="Beat"
          min={BEAT_MIN}
          max={BEAT_MAX}
          step={BEAT_STEP}
          value={beat}
          onChange={next => updateSearch({ beat: clampBeat(next) })}
          valueLabel={`${beat.toFixed(1)} Hz`}
        />
        <SliderRow
          label="Carrier"
          min={CARRIER_MIN}
          max={CARRIER_MAX}
          step={CARRIER_STEP}
          value={carrier}
          onChange={next => updateSearch({ carrier: clampCarrier(next) })}
          valueLabel={`${carrier.toFixed(0)} Hz`}
        />
        <SliderRow
          label="Volume"
          min={0}
          max={1}
          step={VOLUME_STEP}
          value={volume}
          onChange={next => updateSearch({ volume: next })}
          valueLabel={`${Math.round(volume * 100)}%`}
        />
      </section>

      <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-20 text-sm text-muted-foreground">Noise</span>
            <Segmented
              options={NOISE_TYPES}
              labels={NOISE_LABELS}
              value={noise}
              onChange={next => updateSearch({ noise: next })}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Timer</span>
            <Segmented
              options={TIMER_MINUTES_OPTIONS}
              labels={{ 0: 'Off' }}
              value={timer}
              onChange={next => updateSearch({ timer: next as TimerMinutes })}
            />
          </div>
        </div>

        {noise !== 'none' && (
          <SliderRow
            label="Level"
            min={0}
            max={1}
            step={VOLUME_STEP}
            value={noiseLevel}
            onChange={next => updateSearch({ noiseLevel: next })}
            valueLabel={`${Math.round(noiseLevel * 100)}%`}
          />
        )}
      </section>

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Binaural mode needs headphones: the beat only exists when each ear hears its own tone.
        Speaker mode pulses a single tone instead, which carries over a speaker. Evidence that
        either changes focus or sleep is mixed and the reported effects are small; treat this as a
        steady soundscape that masks the room, not as a treatment.
      </p>
    </div>
  );
}

// Route export
export const Route = createFileRoute('/binaural-beats')({
  component: BinauralBeatsPage,
  validateSearch: zodValidator(searchSchema),
});

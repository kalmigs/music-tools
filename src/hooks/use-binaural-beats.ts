import { useCallback, useEffect, useRef, useState } from 'react';

import { carryLoopPosition, renderSessionUrl } from '@/lib/binaural-beats-render';
import {
  type BinauralMode,
  type NoiseType,
  type TimerMinutes,
  DEFAULT_BEAT_HZ,
  DEFAULT_CARRIER_HZ,
  DEFAULT_MODE,
  DEFAULT_NOISE,
  DEFAULT_NOISE_LEVEL,
  DEFAULT_TIMER_MINUTES,
  DEFAULT_VOLUME,
  computeTransportGain,
} from '@/lib/binaural-beats-utils';

// Types
interface UseBinauralBeatsOptions {
  beatHz?: number;
  carrierHz?: number;
  mode?: BinauralMode;
  noise?: NoiseType;
  noiseLevel?: number;
  onComplete?: () => void;
  timerMinutes?: TimerMinutes;
  volume?: number;
}

interface UseBinauralBeatsReturn {
  elapsedSeconds: number;
  isPlaying: boolean;
  /** True while a settings change is being rendered into a new loop. */
  isRendering: boolean;
  play: () => void;
  stop: () => void;
  toggle: () => void;
}

// Constants
/** A slider drag settles before it costs a re-render. */
const RENDER_DEBOUNCE_MS = 300;

/**
 * Ticker driving the fade envelope and the elapsed readout. iOS throttles this to roughly
 * 2 s under lock, which `computeTransportGain` absorbs by recomputing from wall clock.
 */
const TICK_MS = 250;

// Helper functions
function installMediaSession(onPlay: () => void, onPause: () => void): void {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    artist: 'music-tools',
    title: 'Binaural Beats',
  });
  navigator.mediaSession.playbackState = 'playing';

  const handlers: [MediaSessionAction, () => void][] = [
    ['play', onPlay],
    ['pause', onPause],
    ['stop', onPause],
  ];

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Safari rejects actions it does not implement; the rest still install.
    }
  }
}

function clearMediaSession(): void {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

// Main hook
/**
 * Binaural beats playback. Unlike the other tools in this app there is no live
 * `AudioContext` here: iOS suspends one within ~100 ms of the screen locking and never
 * advances it again until unlock, which the 2026-09-08 spike measured across a 124 s lock.
 * A media element playing a pre-rendered loop survives lock instead, verified at 222 s.
 *
 * So settings are rendered offline into a seamless loop, handed to an `<audio>` element,
 * and re-rendered when they change. Both transport fades ride on the element's volume,
 * since a fade baked into a looping buffer would repeat on every pass.
 */
export function useBinauralBeats(options: UseBinauralBeatsOptions = {}): UseBinauralBeatsReturn {
  const {
    beatHz = DEFAULT_BEAT_HZ,
    carrierHz = DEFAULT_CARRIER_HZ,
    mode = DEFAULT_MODE,
    noise = DEFAULT_NOISE,
    noiseLevel = DEFAULT_NOISE_LEVEL,
    onComplete,
    timerMinutes = DEFAULT_TIMER_MINUTES,
    volume = DEFAULT_VOLUME,
  } = options;

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const elementRef = useRef<HTMLAudioElement | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const tickerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const renderGenerationRef = useRef(0);
  const pendingPlayRef = useRef(false);

  // The volume slider and the transport fades both want the element's single volume
  // scalar, so they are held apart and multiplied on every write. A drag mid-fade then
  // cannot clobber the ramp, and the ramp cannot clobber the drag.
  const userVolumeRef = useRef(volume);
  const transportGainRef = useRef(0);

  const timerSecondsRef = useRef(timerMinutes * 60);
  const onCompleteRef = useRef(onComplete);

  // MediaSession handlers are installed once per play but must keep calling the current
  // transport callbacks, so they go through refs rather than captured bindings.
  const playRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    timerSecondsRef.current = timerMinutes * 60;
  }, [timerMinutes]);

  // Declared before the render effect so the element exists by the time it runs.
  useEffect(() => {
    const element = new Audio();
    element.loop = true;
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
    element.style.display = 'none';

    // Attached rather than detached: an in-document media element is the configuration
    // the lock-screen spike verified on iOS.
    document.body.append(element);
    elementRef.current = element;

    return () => {
      element.pause();
      element.remove();
      elementRef.current = null;
      if (sourceUrlRef.current) {
        URL.revokeObjectURL(sourceUrlRef.current);
        sourceUrlRef.current = null;
      }
    };
  }, []);

  const applyVolume = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const level = userVolumeRef.current * transportGainRef.current;
    element.volume = Math.min(1, Math.max(0, level));
  }, []);

  useEffect(() => {
    userVolumeRef.current = volume;
    applyVolume();
  }, [applyVolume, volume]);

  const clearTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTicker();
    pendingPlayRef.current = false;
    transportGainRef.current = 0;

    const element = elementRef.current;
    if (element) {
      element.pause();
      element.currentTime = 0;
      applyVolume();
    }

    setIsPlaying(false);
    setElapsedSeconds(0);
    clearMediaSession();
  }, [applyVolume, clearTicker]);

  const startTicker = useCallback(() => {
    clearTicker();
    tickerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const envelope = computeTransportGain(elapsed, timerSecondsRef.current);

      transportGainRef.current = envelope.gain;
      applyVolume();
      setElapsedSeconds(Math.floor(elapsed));

      if (envelope.complete) {
        stop();
        onCompleteRef.current?.();
      }
    }, TICK_MS);
  }, [applyVolume, clearTicker, stop]);

  const play = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;

    startedAtRef.current = Date.now();
    transportGainRef.current = 0;
    applyVolume();
    setElapsedSeconds(0);
    setIsPlaying(true);
    startTicker();

    // The first render may still be in flight on a cold load; the swap picks this up.
    if (!element.src) {
      pendingPlayRef.current = true;
      return;
    }

    element.currentTime = 0;
    void element
      .play()
      .then(() =>
        // Indirected through refs: the handlers outlive this closure, and reading them
        // directly would reference `play` from inside its own initializer.
        installMediaSession(
          () => playRef.current(),
          () => stopRef.current(),
        ),
      )
      .catch(() => stop());
  }, [applyVolume, startTicker, stop]);

  useEffect(() => {
    playRef.current = play;
    stopRef.current = stop;
  }, [play, stop]);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else play();
  }, [isPlaying, play, stop]);

  const swapSource = useCallback((url: string) => {
    const element = elementRef.current;
    if (!element) {
      URL.revokeObjectURL(url);
      return;
    }

    const previousUrl = sourceUrlRef.current;
    const resumeAt = carryLoopPosition(element.currentTime);
    const shouldPlay = !element.paused || pendingPlayRef.current;

    sourceUrlRef.current = url;
    element.src = url;
    element.load();

    const restore = () => {
      element.currentTime = resumeAt;
      if (shouldPlay) {
        pendingPlayRef.current = false;
        void element.play().catch(() => undefined);
      }
    };

    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) restore();
    else element.addEventListener('loadedmetadata', restore, { once: true });

    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }, []);

  useEffect(() => {
    const generation = renderGenerationRef.current + 1;
    renderGenerationRef.current = generation;

    const timeout = window.setTimeout(() => {
      setIsRendering(true);
      void renderSessionUrl({ beatHz, carrierHz, mode, noise, noiseLevel })
        .then(url => {
          // A later settings change already superseded this render.
          if (renderGenerationRef.current !== generation) {
            URL.revokeObjectURL(url);
            return;
          }
          swapSource(url);
        })
        .catch(() => {
          // A failed render would otherwise leave the transport reporting playback with
          // nothing loaded, so a pending play is reset rather than left hanging.
          if (renderGenerationRef.current === generation && pendingPlayRef.current) {
            stopRef.current();
          }
        })
        .finally(() => {
          if (renderGenerationRef.current === generation) setIsRendering(false);
        });
    }, RENDER_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [beatHz, carrierHz, mode, noise, noiseLevel, swapSource]);

  useEffect(() => clearTicker, [clearTicker]);

  return { elapsedSeconds, isPlaying, isRendering, play, stop, toggle };
}

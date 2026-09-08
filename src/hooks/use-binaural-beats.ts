import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type RenderSettings,
  carryLoopPosition,
  renderSessionUrl,
} from '@/lib/binaural-beats-render';
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
  const isRenderingRef = useRef(false);

  /**
   * Live transport intent, as opposed to whether the element happens to be playing right
   * now. A source swap starts loading before it can start playing, and the user can press
   * Stop in between, so the deferred start reads this rather than a captured flag.
   */
  const wantsPlaybackRef = useRef(false);

  /** Removes whatever load listeners the current source has armed. */
  const detachSourceListenersRef = useRef<(() => void) | null>(null);

  /** Renders the settings as of the latest commit; see the effect that assigns it. */
  const renderNowRef = useRef<() => void>(() => undefined);

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
      detachSourceListenersRef.current?.();
      wantsPlaybackRef.current = false;
      element.pause();
      element.remove();
      elementRef.current = null;
      clearMediaSession();
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
    wantsPlaybackRef.current = false;
    transportGainRef.current = 0;
    detachSourceListenersRef.current?.();

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

  /**
   * Start the element and install the lock-screen controls. Every path that begins
   * playback goes through here, including the deferred one, so a session started while the
   * first render was still in flight is not left without a MediaSession.
   */
  const startElement = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;

    void element
      .play()
      .then(() =>
        // Indirected through refs: the handlers outlive this closure, and reading the
        // transport callbacks directly would reference them from inside their own
        // initializers.
        installMediaSession(
          () => playRef.current(),
          () => stopRef.current(),
        ),
      )
      // A rejection here is usually iOS refusing a play that is no longer tied to a tap.
      // Reset rather than swallow it, or the transport reports playback over silence.
      .catch(() => stopRef.current());
  }, []);

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
    wantsPlaybackRef.current = true;
    applyVolume();
    setElapsedSeconds(0);
    setIsPlaying(true);
    startTicker();

    if (element.src) {
      element.currentTime = 0;
      startElement();
      return;
    }

    // No source yet: either the first render is still in flight, or it failed and left
    // nothing behind. Kicking a render here is what keeps a failure from stranding the
    // transport, since the render effect only re-runs when the settings change.
    if (!isRenderingRef.current) renderNowRef.current();
  }, [applyVolume, startElement, startTicker]);

  useEffect(() => {
    playRef.current = play;
    stopRef.current = stop;
  }, [play, stop]);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else play();
  }, [isPlaying, play, stop]);

  const swapSource = useCallback(
    (url: string) => {
      const element = elementRef.current;
      if (!element) {
        URL.revokeObjectURL(url);
        return;
      }

      // A swap that overtakes an earlier one would otherwise leave the earlier listener
      // armed, and it would then rewind the new source to the old position.
      detachSourceListenersRef.current?.();

      // Captured after the guard so the deferred handlers below keep the narrowed type.
      const media = element;
      const previousUrl = sourceUrlRef.current;
      const resumeAt = carryLoopPosition(media.currentTime);

      sourceUrlRef.current = url;
      media.src = url;
      // `load()` resets readyState to HAVE_NOTHING, so metadata is always awaited rather
      // than sometimes already present.
      media.load();

      const detach = () => {
        media.removeEventListener('loadedmetadata', onLoaded);
        media.removeEventListener('error', onFailed);
        detachSourceListenersRef.current = null;
      };

      function onLoaded() {
        detach();
        media.currentTime = resumeAt;
        // Live intent, not the value captured when the swap started: the user may have
        // pressed Stop while the new source was loading.
        if (wantsPlaybackRef.current) startElement();
      }

      function onFailed() {
        detach();
        // Without this the transport would sit reporting playback against a source that
        // will never fire `loadedmetadata`.
        if (wantsPlaybackRef.current) stopRef.current();
      }

      media.addEventListener('loadedmetadata', onLoaded, { once: true });
      media.addEventListener('error', onFailed, { once: true });
      detachSourceListenersRef.current = detach;

      if (previousUrl) URL.revokeObjectURL(previousUrl);
    },
    [startElement],
  );

  const render = useCallback(
    (settings: RenderSettings) => {
      const generation = renderGenerationRef.current + 1;
      renderGenerationRef.current = generation;

      setIsRendering(true);
      isRenderingRef.current = true;

      void renderSessionUrl(settings)
        .then(url => {
          // A later settings change already superseded this render.
          if (renderGenerationRef.current !== generation) {
            URL.revokeObjectURL(url);
            return;
          }
          swapSource(url);
        })
        .catch(() => {
          // Nothing was produced, so a session waiting on this render has to be released
          // rather than left counting up in silence. Pressing Play again retries.
          if (renderGenerationRef.current === generation && wantsPlaybackRef.current) {
            stopRef.current();
          }
        })
        .finally(() => {
          if (renderGenerationRef.current !== generation) return;
          setIsRendering(false);
          isRenderingRef.current = false;
        });
    },
    [swapSource],
  );

  // `play` reaches the current render through a ref so it does not have to depend on
  // settings that change on every slider move.
  useEffect(() => {
    renderNowRef.current = () => render({ beatHz, carrierHz, mode, noise, noiseLevel });
  }, [beatHz, carrierHz, mode, noise, noiseLevel, render]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => render({ beatHz, carrierHz, mode, noise, noiseLevel }),
      RENDER_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [beatHz, carrierHz, mode, noise, noiseLevel, render]);

  useEffect(() => clearTicker, [clearTicker]);

  return { elapsedSeconds, isPlaying, isRendering, play, stop, toggle };
}

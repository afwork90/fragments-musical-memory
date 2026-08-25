let unlockArmed = false;
let unlocked = false;
let unlockPromise: Promise<void> | null = null;

/** Resume/create a short AudioContext so later HTMLAudioElement.play() calls are allowed. */
export function unlockBrowserAudio(): Promise<void> {
  if (unlocked) return Promise.resolve();
  if (unlockPromise) return unlockPromise;

  unlockPromise = (async () => {
    try {
      const AudioContextCtor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        if (context.state === "suspended") await context.resume();
        const buffer = context.createBuffer(1, 1, 22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
        await context.close();
      }
    } catch {
      // Best-effort; playMediaElement still retries.
    } finally {
      unlocked = true;
    }
  })();

  return unlockPromise;
}

/** Call once from the app shell so the first click/key unlocks audio policy. */
export function armBrowserAudioUnlock() {
  if (typeof window === "undefined" || unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    void unlockBrowserAudio();
  };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
}

/**
 * Start playback while still in (or right after) a user gesture.
 * Retries once after unlocking AudioContext if the browser blocks the first attempt.
 */
export function playMediaElement(audio: HTMLMediaElement, onBlocked?: () => void) {
  const attempt = () => {
    const result = audio.play();
    if (!result) return;
    result.catch(async () => {
      await unlockBrowserAudio();
      try {
        await audio.play();
      } catch {
        onBlocked?.();
      }
    });
  };

  attempt();
}

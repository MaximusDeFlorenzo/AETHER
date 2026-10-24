// Looping emergency siren for the citizen alarm screen. Reuses the
// "ongoing hazard" clip the analyst alerts already ship
// (lib/alert-sound.ts), looped rather than played once. Browsers block
// audio until the page has had a user gesture, so start() reports whether
// it actually got to play — the alarm screen then offers a "Bunyikan
// sirine" button instead of failing silently.
const SIREN_SRC = '/sounds/mixkit-facility-alarm-sound-999.wav';
const VIBRATION_PATTERN = [600, 250, 600, 250, 600, 250, 1000];

let clip: HTMLAudioElement | null = null;

export async function startSiren(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    navigator.vibrate?.(VIBRATION_PATTERN);
  } catch {
    // Vibration unsupported (desktop, iOS) — visual + audio still carry it.
  }
  try {
    clip ??= new Audio(SIREN_SRC);
    clip.loop = true;
    clip.volume = 1;
    await clip.play();
    return true;
  } catch {
    return false;
  }
}

export function stopSiren() {
  try {
    navigator.vibrate?.(0);
  } catch {
    // ignore
  }
  if (clip) {
    clip.pause();
    clip.currentTime = 0;
  }
}

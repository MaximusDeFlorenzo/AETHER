import type { PublicAlertLevel } from './types';

// Looping emergency siren for the citizen alarm screen. Reuses the
// "ongoing hazard" clip the analyst alerts already ship
// (lib/alert-sound.ts), looped rather than played once. Browsers block
// audio until the page has had a user gesture, so start() reports whether
// it actually got to play — the alarm screen then offers a "Bunyikan
// sirine" button instead of failing silently.
const SIREN_SRC = '/sounds/mixkit-facility-alarm-sound-999.wav';
const VIBRATION_PATTERN = [600, 250, 600, 250, 600, 250, 1000];

let clip: HTMLAudioElement | null = null;

// How many times the clip plays per level: Awas loops until silenced,
// Siaga sounds a few times, Waspada once.
const PLAYS: Record<PublicAlertLevel, number> = { awas: Infinity, siaga: 3, waspada: 1 };
let playsLeft = 0;

export async function startSiren(level: PublicAlertLevel = 'awas'): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    navigator.vibrate?.(VIBRATION_PATTERN);
  } catch {
    // Vibration unsupported (desktop, iOS) — visual + audio still carry it.
  }
  try {
    if (!clip) {
      clip = new Audio(SIREN_SRC);
      clip.addEventListener('ended', () => {
        playsLeft -= 1;
        if (playsLeft > 0 && clip) void clip.play().catch(() => undefined);
      });
    }
    playsLeft = PLAYS[level];
    clip.loop = playsLeft === Infinity;
    clip.volume = 1;
    clip.currentTime = 0;
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

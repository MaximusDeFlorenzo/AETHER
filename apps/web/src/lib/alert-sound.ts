let sharedAudioContext: AudioContext | null = null;
const sharedClips: Partial<Record<AlertSoundKind, HTMLAudioElement>> = {};

export type AlertSoundKind = 'new' | 'ongoing';

// 'new' = first detection of a hazard event (hazard_event.created /
// hazard_relationship.detected). 'ongoing' = the hazard is still active on a
// later recheck (useOngoingHazardAlerts) — a distinct, more insistent alarm
// so an analyst can tell by ear whether this is a fresh event or one that's
// still unresolved.
const ALERT_CLIP_SRC: Record<AlertSoundKind, string> = {
  new: '/sounds/hazard-alert.mp3',
  ongoing: '/sounds/mixkit-facility-alarm-sound-999.wav',
};

/**
 * Alert sound for high-severity realtime events. Reused for every
 * "this is urgent" push in use-realtime-sync.ts and useOngoingHazardAlerts,
 * kept separate from the toast itself so the visual alert always fires even
 * if audio is blocked/unsupported. Falls back to a synthesized two-tone
 * chime (Web Audio, no asset dependency) if the clip fails to load/play.
 */
export function playAlertSound(kind: AlertSoundKind = 'new') {
  if (typeof window === 'undefined') return;
  try {
    sharedClips[kind] ??= new Audio(ALERT_CLIP_SRC[kind]);
    const clip = sharedClips[kind];
    clip.currentTime = 0;
    clip.play().catch(playSynthesizedChime);
  } catch {
    playSynthesizedChime();
  }
}

function playSynthesizedChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    sharedAudioContext ??= new Ctx();
    if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume();

    const ctx = sharedAudioContext;
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const start = now + i * 0.18;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    });
  } catch {
    // Audio blocked (autoplay policy) or unsupported — the toast still carries the alert visually.
  }
}

let sharedAudioContext: AudioContext | null = null;

/**
 * Short two-tone alert chime for high-severity realtime events, synthesized
 * via Web Audio (no audio asset to ship/host). Reused for every "this is
 * urgent" push in use-realtime-sync.ts, kept separate from the toast itself
 * so the visual alert always fires even if audio is blocked/unsupported.
 */
export function playAlertSound() {
  if (typeof window === 'undefined') return;
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

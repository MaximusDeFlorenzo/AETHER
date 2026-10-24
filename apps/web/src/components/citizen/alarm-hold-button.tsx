'use client';

import { useState } from 'react';
import { BellRing, Hand, Loader2 } from 'lucide-react';
import { HoldButton } from '@/components/ui/hold-button';
import { cn } from '@/lib/utils';

const HOLD_MS = 1500;

/**
 * "Tahan untuk mengaktifkan" for emergency alarms: a deliberate hold rather
 * than a tap, so turning on a siren-level notification is never accidental.
 * `onConfirm` runs the async enable; on failure the button rewinds (remount
 * via `attempt`) so the citizen can hold again.
 */
export function AlarmHoldButton({
  label,
  onConfirm,
  onDark = false,
  className,
}: {
  label: string;
  onConfirm: () => Promise<boolean>;
  /** Hint text on a dark/brand background (the welcome hero). */
  onDark?: boolean;
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [nudge, setNudge] = useState(false);

  const confirm = async () => {
    setNudge(false);
    const ok = await onConfirm();
    if (!ok) setAttempt((n) => n + 1);
  };

  return (
    <div className={cn('grid gap-1.5', className)}>
      <HoldButton
        key={attempt}
        size="lg"
        radius={18}
        holdTime={HOLD_MS}
        resetAfter={0}
        backgroundColor="var(--lv-awas-soft)"
        textColor="var(--lv-awas)"
        fillColor="var(--alarm)"
        fillTextColor="#ffffff"
        icon={<BellRing className="h-5 w-5" />}
        doneIcon={<Loader2 className="h-5 w-5 animate-spin" />}
        doneLabel="Mengaktifkan…"
        onHold={confirm}
        onTap={() => setNudge(true)}
        className="h-14 w-full px-4 text-base font-black ring-2 ring-lv-awas/30 sm:text-[17px]"
      >
        {label}
      </HoldButton>
      <p
        className={cn(
          'flex items-center justify-center gap-1.5 text-center text-xs font-bold transition-colors',
          nudge ? (onDark ? 'text-[#ffb3b3]' : 'text-lv-awas') : onDark ? 'text-white/70' : 'text-muted-foreground',
        )}
        aria-live="polite"
      >
        <Hand className="h-3.5 w-3.5" />
        {nudge ? 'Tahan tombolnya sampai penuh, jangan hanya diketuk' : 'Tekan dan tahan ± 1,5 detik untuk mengaktifkan'}
      </p>
    </div>
  );
}

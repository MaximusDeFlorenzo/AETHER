'use client';

import { useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Aktifkan peringatan darurat": a plain tap. It used to need a 1.5 s hold so
 * it could never be switched on by accident, but the browser's own
 * "Allow notifications?" prompt that follows already is that confirmation.
 * `onConfirm` runs the async enable; the button shows progress meanwhile.
 * (Name kept so existing imports stay valid.)
 */
export function AlarmHoldButton({
  label,
  onConfirm,
  onDark = false,
  className,
}: {
  label: string;
  onConfirm: () => Promise<boolean>;
  /** On a dark/brand background (the welcome hero). */
  onDark?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={confirm}
      disabled={busy}
      className={cn(
        'inline-flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-lv-awas-soft px-4 text-base font-black text-lv-awas ring-2 ring-lv-awas/30 transition-transform active:scale-[0.99] disabled:opacity-80 sm:text-[17px]',
        onDark && 'shadow-[0_12px_30px_-12px_rgba(193,18,31,0.6)]',
        className,
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
      {busy ? 'Mengaktifkan…' : label}
    </button>
  );
}

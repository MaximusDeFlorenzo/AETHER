'use client';

import { useEffect, useState } from 'react';
import { BellRing, EllipsisVertical, MapPin, Share, ShieldCheck, SquarePlus, X, Zap } from 'lucide-react';
import { BrandMark } from '@/components/shared/brand-logo';
import { promptInstall, useInstallState } from './install-app-button';

const DISMISSED_KEY = 'aether-install-prompt-dismissed-at';
// "Nanti saja" hides the invitation for a week, not forever.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2_500;

const BENEFITS = [
  { icon: BellRing, text: 'Peringatan darurat dari BPBD dan BMKG langsung masuk, walau AETHER sedang tidak dibuka' },
  { icon: MapPin, text: 'Status bahaya dan titik kumpul terdekat untuk wilayah Anda' },
  { icon: Zap, text: 'Sekali ketuk dari layar utama, ringan, tanpa unduh dari Play Store' },
];

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/** Invitation to install AETHER, shown a moment after the first visit's
 * intro (`ready`). Bottom sheet on phones, floating card on wide screens. */
export function InstallPrompt({ ready }: { ready: boolean }) {
  const state = useInstallState();
  const [open, setOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (!ready || !state || state.installed || snoozed()) return;
    const timer = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, state]);

  // Installed from the prompt (or elsewhere): close.
  useEffect(() => {
    if (state?.installed) setOpen(false);
  }, [state?.installed]);

  if (!open || !state) return null;

  const later = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // Storage blocked — it simply asks again next visit.
    }
    setOpen(false);
  };

  const install = async () => {
    if (await promptInstall()) setOpen(false);
    else setShowSteps(true);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-navy-dark/40 backdrop-blur-[2px] sm:items-end sm:justify-end sm:bg-transparent sm:p-6 sm:backdrop-blur-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        className="citizen-rise relative grid w-full gap-4 rounded-t-[28px] border border-border/70 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_-12px_rgba(8,27,58,0.45)] sm:max-w-sm sm:rounded-[28px] sm:pb-5"
      >
        <button
          type="button"
          onClick={later}
          aria-label="Tutup"
          className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-navy to-primary shadow-[0_10px_24px_-10px_var(--primary)]">
            <BrandMark className="h-8" />
          </span>
          <div className="grid gap-0.5">
            <h2 id="install-title" className="text-lg leading-tight font-black">
              Pasang AETHER di HP Anda
            </h2>
            <p className="text-sm text-muted-foreground">Selangkah lebih siap menghadapi bencana.</p>
          </div>
        </div>

        <ul className="grid gap-2.5 text-sm">
          {BENEFITS.map((benefit) => (
            <li key={benefit.text} className="flex gap-2.5">
              <benefit.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{benefit.text}</span>
            </li>
          ))}
        </ul>

        {showSteps && (
          <div role="note" className="grid gap-1.5 rounded-2xl bg-accent p-3 text-sm">
            <p className="font-black">Cara memasang:</p>
            {state.ios ? (
              <p>
                Di Safari, ketuk <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Bagikan</strong>, lalu pilih{' '}
                <SquarePlus className="inline h-4 w-4 align-text-bottom" /> <strong>Tambahkan ke Layar Utama</strong>.
              </p>
            ) : (
              <p>
                Ketuk menu <EllipsisVertical className="inline h-4 w-4 align-text-bottom" /> di pojok kanan atas browser, lalu pilih{' '}
                <strong>Instal aplikasi</strong> atau <strong>Tambahkan ke layar utama</strong>.
              </p>
            )}
          </div>
        )}

        {state.ios && !showSteps && (
          <p className="flex gap-2 rounded-2xl bg-lv-siaga-soft p-3 text-xs font-bold text-lv-siaga">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Di iPhone, peringatan darurat hanya bisa diterima setelah AETHER dipasang di Layar Utama.
          </p>
        )}

        <div className="grid gap-2">
          <button
            type="button"
            onClick={showSteps ? later : install}
            className="h-12 rounded-2xl bg-primary px-4 text-base font-black text-primary-foreground shadow-[0_10px_24px_-12px_var(--primary)] transition-transform active:scale-[0.99]"
          >
            {showSteps ? 'Mengerti' : 'Pasang sekarang'}
          </button>
          {!showSteps && (
            <button type="button" onClick={later} className="h-10 rounded-2xl text-sm font-bold text-muted-foreground hover:bg-accent">
              Nanti saja
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

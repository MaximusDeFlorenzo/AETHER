'use client';

import { useEffect, useState } from 'react';
import { Download, EllipsisVertical, Share, SquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome/Edge/Android fire `beforeinstallprompt` once, often before this
// component mounts, so it is caught at module load and kept here.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Round install icon (top-right of the welcome card), hidden once AETHER runs installed. Uses the
 * browser's install prompt where there is one (Chrome/Edge/Android on
 * HTTPS); otherwise — Safari, Firefox, or before Chrome offers the prompt —
 * it shows how to add AETHER to the home screen by hand. */
export function InstallAppButton({ className }: { className?: string }) {
  const [state, setState] = useState<{ installed: boolean; canPrompt: boolean; ios: boolean } | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const update = () => setState({ installed: isStandalone(), canPrompt: deferredPrompt !== null, ios: isIos() });
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  // Server render / already installed: nothing to offer.
  if (!state || state.installed) return null;

  const install = async () => {
    const prompt = deferredPrompt;
    if (!prompt) {
      setShowSteps((open) => !open);
      return;
    }
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    // A prompt can only be used once; the browser fires a new event if it may ask again.
    deferredPrompt = null;
    notify();
  };

  return (
    <div className={cn('z-10', className)}>
      <button
        type="button"
        onClick={install}
        aria-label="Pasang aplikasi AETHER"
        title="Pasang aplikasi AETHER"
        aria-expanded={state.canPrompt ? undefined : showSteps}
        className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20 sm:h-10 sm:w-10"
      >
        <Download className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>
      {showSteps && !state.canPrompt && (
        <p
          role="note"
          className="absolute top-full right-0 mt-2 w-60 rounded-2xl bg-navy-dark/95 p-3 text-xs text-white/85 shadow-lg ring-1 ring-white/15 backdrop-blur"
        >
          <strong className="mb-1 block text-white">Pasang aplikasi AETHER</strong>
          {state.ios ? (
            <>
              Di Safari, ketuk <Share className="inline h-3.5 w-3.5 align-text-bottom" /> <strong className="text-white">Bagikan</strong> →{' '}
              <SquarePlus className="inline h-3.5 w-3.5 align-text-bottom" />{' '}
              <strong className="text-white">Tambahkan ke Layar Utama</strong>.
            </>
          ) : (
            <>
              Buka menu browser <EllipsisVertical className="inline h-3.5 w-3.5 align-text-bottom" /> lalu pilih{' '}
              <strong className="text-white">Instal aplikasi</strong> atau{' '}
              <strong className="text-white">Tambahkan ke layar utama</strong>.
            </>
          )}
        </p>
      )}
    </div>
  );
}

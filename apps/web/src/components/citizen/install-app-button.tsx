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

/** Small "install the app" pill, hidden once AETHER runs installed. Uses the
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
    <div className={cn('grid justify-items-center gap-2', className)}>
      <button
        type="button"
        onClick={install}
        aria-expanded={state.canPrompt ? undefined : showSteps}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
      >
        <Download className="h-3.5 w-3.5 text-cyan" /> Pasang aplikasi AETHER
      </button>
      {showSteps && !state.canPrompt && (
        <p role="note" className="max-w-xs text-center text-xs text-white/80">
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

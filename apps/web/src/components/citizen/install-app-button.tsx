'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openInstallPrompt } from './install-prompt';

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

export interface InstallState {
  installed: boolean;
  /** The browser offered its own install prompt (Chrome/Edge/Android, HTTPS). */
  canPrompt: boolean;
  ios: boolean;
}

/** Live install state; null during the server render. */
export function useInstallState(): InstallState | null {
  const [state, setState] = useState<InstallState | null>(null);
  useEffect(() => {
    const update = () => setState({ installed: isStandalone(), canPrompt: deferredPrompt !== null, ios: isIos() });
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}

/** Resolves true once the browser's install prompt is available, false if it
 * doesn't arrive within `timeoutMs`. Chrome only fires it a few seconds after
 * load, once it has checked the manifest and service worker. */
export function waitForInstallPrompt(timeoutMs: number): Promise<boolean> {
  if (deferredPrompt) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      listeners.delete(check);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const check = () => {
      if (deferredPrompt) done(true);
    };
    const timer = window.setTimeout(() => done(deferredPrompt !== null), timeoutMs);
    listeners.add(check);
  });
}

/** Shows the browser's install prompt. false when there is none to show
 * (the caller then explains the manual Add-to-Home-Screen steps). */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferredPrompt;
  if (!prompt) return false;
  await prompt.prompt();
  await prompt.userChoice.catch(() => undefined);
  // A prompt can only be used once; the browser fires a new event if it may ask again.
  deferredPrompt = null;
  notify();
  return true;
}

/** Round install icon (top-right of the home cards), hidden once AETHER runs
 * installed. Uses the browser's install prompt where there is one
 * (Chrome/Edge/Android on HTTPS); otherwise opens the install modal, which
 * explains adding AETHER to the home screen by hand. */
export function InstallAppButton({ className }: { className?: string }) {
  const state = useInstallState();

  // Server render / already installed: nothing to offer.
  if (!state || state.installed) return null;

  const install = async () => {
    if (!state.ios) await waitForInstallPrompt(4_000);
    // No browser prompt (iPhone, Firefox, …): the invitation modal explains
    // the manual steps — never inline in the card.
    if (!(await promptInstall())) openInstallPrompt();
  };

  return (
    <div className={cn('z-10', className)}>
      <button
        type="button"
        onClick={install}
        aria-label="Pasang aplikasi AETHER"
        title="Pasang aplikasi AETHER"
        className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20 sm:h-10 sm:w-10"
      >
        <Download className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>
    </div>
  );
}

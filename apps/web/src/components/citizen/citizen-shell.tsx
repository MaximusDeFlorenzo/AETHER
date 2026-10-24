'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpen, ChevronDown, Loader2, Navigation, Globe, House, Map as MapIcon, MapPin, Phone, ShieldCheck, type LucideIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { BrandLogo } from '@/components/shared/brand-logo';
import { locationSummary } from '@/lib/citizen/geo';
import { disableAlarmPush } from '@/lib/citizen/push';
import { useAutoLocation } from '@/hooks/use-auto-location';
import type { CitizenLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useCitizenStore } from '@/stores/citizen-store';
import { AlarmWatcher } from './alarm-watcher';
import { LocationPicker } from './location-picker';
import { Onboarding } from './onboarding';

interface CitizenNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const CITIZEN_NAV: CitizenNavItem[] = [
  { href: '/', label: 'Beranda', icon: House },
  { href: '/indonesia', label: 'Indonesia', icon: Globe },
  { href: '/peta', label: 'Peta', icon: MapIcon },
  { href: '/panduan', label: 'Panduan', icon: BookOpen },
  { href: '/darurat', label: 'Darurat', icon: Phone },
];

// Phones: Darurat moves to the centre slot of the bottom bar.
const MOBILE_NAV = ['/', '/indonesia', '/darurat', '/peta', '/panduan'].flatMap((href) =>
  CITIZEN_NAV.filter((item) => item.href === href),
);

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface LocationPickerContextValue {
  openPicker: (options?: { onPicked?: (location: CitizenLocation) => void; title?: string }) => void;
  /** Replays the intro animation (e.g. from Panduan). */
  openIntro: () => void;
}

const LocationPickerContext = createContext<LocationPickerContextValue | null>(null);

export function useLocationPicker() {
  const ctx = useContext(LocationPickerContext);
  if (!ctx) throw new Error('useLocationPicker must be used within CitizenShell');
  return ctx;
}

/**
 * Public, login-free shell for the citizen portal. Responsive by design:
 * phones get a thumb-reach bottom tab bar; tablets and laptops get the same
 * five destinations in the top bar, with pages widening into multi-column
 * layouts. Hosts the alarm watcher so a red screen can interrupt any page.
 */
export function CitizenShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const location = useCitizenStore((state) => state.location);
  const setLocation = useCitizenStore((state) => state.setLocation);
  const clearLocation = useCitizenStore((state) => state.clearLocation);
  const pushEnabled = useCitizenStore((state) => state.pushEnabled);
  const autoLocate = useCitizenStore((state) => state.autoLocate);
  // The intro auto-plays until the citizen skips or finishes it once
  // (persisted as introSeen); after that it only opens on request.
  const introSeen = useCitizenStore((state) => state.introSeen);
  const markIntroSeen = useCitizenStore((state) => state.markIntroSeen);
  const [introRequested, setIntroRequested] = useState(false);
  const introOpen = introRequested || !introSeen;
  const setIntroOpen = (open: boolean) => {
    setIntroRequested(open);
    if (!open) markIntroSeen();
  };
  const setAutoLocate = useCitizenStore((state) => state.setAutoLocate);
  const hasHydrated = useCitizenStore((state) => state.hasHydrated);
  const signedIn = useAuthStore((state) => state.hasHydrated && !!state.accessToken);
  const router = useRouter();
  const [previewAsCitizen, setPreviewAsCitizen] = useState<boolean | null>(null);

  // This portal is for the general public. Signed-in staff get the original
  // analyst workspace instead, on every portal page — except when they
  // deliberately open it via "Portal Warga" (`/?lihat=warga`), remembered
  // for the tab so navigating within the portal doesn't bounce them out.
  useEffect(() => {
    let preview = new URLSearchParams(window.location.search).get('lihat') === 'warga';
    try {
      if (preview) sessionStorage.setItem('aether-lihat-warga', '1');
      else preview = sessionStorage.getItem('aether-lihat-warga') === '1';
    } catch {
      // Storage blocked — the query param alone still works.
    }
    setPreviewAsCitizen(preview);
  }, []);
  const redirectToWorkspace = signedIn && previewAsCitizen === false;
  useAutoLocation(!redirectToWorkspace);
  useEffect(() => {
    if (redirectToWorkspace) router.replace('/risk-map');
  }, [redirectToWorkspace, router]);
  const [picker, setPicker] = useState<{
    open: boolean;
    title?: string;
    onPicked?: (location: CitizenLocation) => void;
  }>({ open: false });

  const openPicker = useCallback<LocationPickerContextValue['openPicker']>((options) => {
    setPicker({ open: true, title: options?.title, onPicked: options?.onPicked });
  }, []);

  return (
    <LocationPickerContext.Provider value={{ openPicker, openIntro: () => setIntroOpen(true) }}>
      <div lang="id" className="citizen-backdrop flex min-h-svh flex-col font-citizen">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur-xl supports-[backdrop-filter]:bg-card/65">
          <div aria-hidden className="h-[3px] bg-gradient-to-r from-navy via-primary to-cyan" />
          <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-3 px-4 sm:h-16 sm:px-6 lg:px-8 2xl:px-10">
            <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="AETHER Siaga, beranda">
              <BrandLogo priority markClassName="h-7 sm:h-8" className="text-foreground" />
              <span className="hidden rounded-full bg-lv-awas-soft px-2 py-0.5 text-[11px] font-black tracking-wide text-lv-awas uppercase sm:inline">
                Siaga
              </span>
            </Link>

            <nav aria-label="Menu utama" className="ml-2 hidden h-full items-center md:flex">
              {CITIZEN_NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative mx-0.5 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[15px] font-bold transition-colors lg:px-3.5',
                      active ? 'bg-accent text-primary' : 'text-foreground/70 hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <item.icon className={cn('h-4 w-4', !active && 'hidden lg:block')} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
              {hasHydrated && location && (
                <button
                  type="button"
                  onClick={() => openPicker()}
                  className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1.5 text-sm font-bold shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  {autoLocate ? (
                    <Navigation className="h-4 w-4 shrink-0 text-primary" aria-label="Lokasi diperbarui otomatis" />
                  ) : (
                    <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{locationSummary(location)}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              )}
              <ThemeToggle />
              <Link
                href={signedIn ? '/risk-map' : '/admin/login'}
                onClick={() => {
                  try {
                    sessionStorage.removeItem('aether-lihat-warga');
                  } catch {
                    // ignore
                  }
                }}
                className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-foreground/70 hover:bg-accent hover:text-foreground lg:flex"
              >
                <ShieldCheck className="h-4 w-4" /> {signedIn ? 'Dashboard petugas' : 'Petugas'}
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 pb-28 md:pb-12">
          {redirectToWorkspace ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            children
          )}
        </main>

        <footer className="hidden border-t border-border/60 bg-card/50 md:block">
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-5 text-sm text-muted-foreground lg:px-8 2xl:px-10">
            <p>
              Data: BMKG, NASA FIRMS, BNPB InaRISK, Open-Meteo, dan petugas BPBD. Dalam keadaan darurat hubungi{' '}
              <strong className="text-foreground">112</strong>.
            </p>
            <button type="button" onClick={() => setIntroOpen(true)} className="font-bold hover:text-foreground">
              Lihat pengenalan aplikasi
            </button>
            <Link href={signedIn ? '/risk-map' : '/admin/login'} className="font-bold hover:text-foreground">
              {signedIn ? 'Kembali ke dashboard petugas' : 'Masuk sebagai petugas'}
            </Link>
          </div>
        </footer>

        <nav
          aria-label="Menu utama"
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="mx-auto grid max-w-lg grid-cols-5 items-end rounded-[26px] border border-border/70 bg-card/90 px-1 pt-1.5 pb-1.5 shadow-[0_12px_32px_-12px_rgba(20,33,61,0.35)] backdrop-blur-xl">
            {MOBILE_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              if (item.href === '/darurat') {
                // Emergency sits in the middle as a raised SOS button, reachable by thumb.
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label="Darurat, nomor 112"
                    className="grid justify-items-center gap-0.5 py-1 text-[11px] font-black text-alarm"
                  >
                    <span className="-mt-7 grid h-14 w-14 place-items-center rounded-[20px] border-4 border-card bg-alarm font-black text-white shadow-[0_10px_24px_-10px_var(--alarm)] transition-transform active:scale-95">
                      SOS
                    </span>
                    112
                  </Link>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'grid justify-items-center gap-0.5 rounded-xl py-1 text-[11px] font-extrabold',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-12 place-items-center rounded-full transition-all duration-300',
                      active && 'bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_var(--primary)]',
                    )}
                  >
                    <Icon className="h-[21px] w-[21px]" />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <LocationPicker
          open={picker.open}
          title={picker.title}
          onOpenChange={(open) => setPicker((current) => ({ ...current, open }))}
          onSelect={(picked) => {
            if (picker.onPicked) picker.onPicked(picked);
            else setLocation(picked);
          }}
          mode={picker.onPicked ? 'family' : 'self'}
          autoLocate={autoLocate}
          onAutoLocateChange={setAutoLocate}
          current={picker.onPicked ? null : location}
          alarmsEnabled={pushEnabled}
          onReset={
            picker.onPicked
              ? undefined
              : async () => {
                  // Stop alarms for the old area server-side too, not just locally.
                  if (pushEnabled) await disableAlarmPush().catch(() => undefined);
                  clearLocation();
                }
          }
        />
        <AlarmWatcher />
        {hasHydrated && introOpen && !signedIn && <Onboarding onClose={() => setIntroOpen(false)} />}
      </div>
    </LocationPickerContext.Provider>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BellRing,
  CircleCheck,
  Loader2,
  LocateFixed,
  MapPin,
  Share,
  Siren,
  SquarePlus,
} from 'lucide-react';
import { useDistricts } from '@/hooks/use-geo';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { CITIZEN_HAZARD_COLORS } from '@/lib/chart-colors';
import { locationFullName } from '@/lib/citizen/geo';
import { DETECT_ERROR_TEXT, detectLocation, type LocatePrecision } from '@/lib/citizen/locate';
import { enableAlarmPush, getPushSupport, type PushSupport } from '@/lib/citizen/push';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import { AlarmHoldButton } from './alarm-hold-button';
import { useLocationPicker } from './citizen-shell';

// WebGL-only and ~60 KB, so it loads after the intro instead of blocking it.
const Topography = dynamic(() => import('@/components/shared/topography'), { ssr: false });

// Equirectangular frame around the archipelago (lng 94.5–141.5, lat 6.5 to -11.5).
const VIEW_W = 1000;
const VIEW_H = 383;
const project = (lng: number, lat: number) => ({
  x: ((lng - 94.5) / 47) * VIEW_W,
  y: ((6.5 - lat) / 18) * VIEW_H,
});
// The west→east sweep takes this long; pulses start once it's mostly drawn.
const SWEEP_MS = 1600;

// Phases of the self-playing intro, and when each begins (ms).
const PHASES = [
  { at: 0 }, // 0: the map draws itself
  { at: 1400 }, // 1: hazards pulse — "every day, somewhere in Indonesia"
  { at: 4200 }, // 2: "AETHER Siaga watches them for you"
  { at: 6800 }, // 3: your area → red alarm
  { at: 9400 }, // 4: call to action (stays)
];
const FINAL = PHASES.length - 1;

/** Indonesia drawn from the real kabupaten/kota reference points, with
 * rings pulsing on the most recent real hazard events. */
function IndonesiaDots({ showPulses, dim }: { showPulses: boolean; dim: boolean }) {
  const districts = useDistricts();
  const events = useHazardEvents({ limit: 8 });

  const dots = useMemo(
    () =>
      (districts.data ?? []).flatMap((district) => {
        const point = district.geom?.coordinates;
        if (!point) return [];
        const { x, y } = project(point[0], point[1]);
        return [{ id: district.id, x, y, delay: ((point[0] - 94.5) / 47) * SWEEP_MS }];
      }),
    [districts.data],
  );
  const pulses = useMemo(
    () =>
      (events.data?.data ?? []).slice(0, 6).map((event, index) => ({
        id: event.id,
        ...project(event.longitude, event.latitude),
        color: CITIZEN_HAZARD_COLORS[event.hazardType],
        delay: index * 350,
      })),
    [events.data],
  );

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={cn('h-auto w-full transition-opacity duration-700', dim ? 'opacity-35' : 'opacity-100')}
      aria-hidden
    >
      {dots.map((dot) => (
        <circle
          key={dot.id}
          cx={dot.x}
          cy={dot.y}
          r={4}
          className="intro-dot fill-white"
          style={{ animationDelay: `${dot.delay}ms` }}
        />
      ))}
      {showPulses &&
        pulses.map((pulse) => (
          <g key={pulse.id}>
            <circle
              cx={pulse.x}
              cy={pulse.y}
              r={9}
              fill="none"
              stroke={pulse.color}
              strokeWidth={3}
              className="intro-ring"
              style={{ animationDelay: `${pulse.delay}ms` }}
            />
            <circle cx={pulse.x} cy={pulse.y} r={6} fill={pulse.color} stroke="white" strokeWidth={2} />
          </g>
        ))}
    </svg>
  );
}

function Caption({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'absolute inset-x-0 grid gap-2 text-center transition-all duration-700',
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

/** Phase 3: "your area" card that turns into the red alarm. */
function AlarmMoment({ show }: { show: boolean }) {
  const [red, setRed] = useState(false);
  useEffect(() => {
    if (!show) return;
    const timer = window.setTimeout(() => setRed(true), 1100);
    return () => window.clearTimeout(timer);
  }, [show]);
  return (
    <div
      className={cn(
        'absolute top-1/2 left-1/2 w-[min(320px,80%)] -translate-x-1/2 -translate-y-1/2 transition-all duration-700',
        show ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
      )}
      aria-hidden
    >
      <div
        className={cn(
          'grid gap-2 rounded-3xl p-5 shadow-2xl transition-colors duration-300',
          red ? 'bg-alarm text-white' : 'bg-card',
        )}
      >
        <p className={cn('flex items-center gap-1.5 text-xs font-bold', red ? 'text-white/90' : 'text-muted-foreground')}>
          <MapPin className="h-3.5 w-3.5" /> Wilayah Anda
        </p>
        {red ? (
          <>
            <p className="flex items-center gap-2 text-xs font-black tracking-widest uppercase">
              <Siren className="h-4 w-4" /> Peringatan darurat
            </p>
            <p className="text-2xl leading-tight font-black uppercase">Pergi ke posko sekarang</p>
          </>
        ) : (
          <p className="text-2xl font-black text-lv-normal">Normal</p>
        )}
      </div>
    </div>
  );
}

const PRECISION_TEXT: Record<LocatePrecision, string> = {
  desa: 'sampai desa/kelurahan',
  kecamatan: 'sampai kecamatan',
  kabupaten: 'sampai kabupaten/kota',
};

/** Phase 4: the part that stays — location, then alarms, then in. */
function CallToAction({ onDone }: { onDone: () => void }) {
  const location = useCitizenStore((state) => state.location);
  const setLocation = useCitizenStore((state) => state.setLocation);
  const setAutoLocate = useCitizenStore((state) => state.setAutoLocate);
  const pushEnabled = useCitizenStore((state) => state.pushEnabled);
  const setPushEnabled = useCitizenStore((state) => state.setPushEnabled);
  const { openPicker } = useLocationPicker();
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [precision, setPrecision] = useState<LocatePrecision | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => setSupport(getPushSupport()), []);

  const detect = async () => {
    setLocating(true);
    setLocateError(null);
    const result = await detectLocation();
    setLocating(false);
    if (!result.ok) {
      setLocateError(DETECT_ERROR_TEXT[result.reason]);
      return;
    }
    setLocation(result.location);
    setAutoLocate(true);
    setPrecision(result.precision);
  };

  const enable = async () => {
    if (!location) return false;
    setPushMessage(null);
    const result = await enableAlarmPush(location);
    setSupport(getPushSupport());
    if (result === 'enabled') {
      setPushEnabled(true);
      return true;
    }
    if (result === 'denied') setPushMessage('Izin notifikasi ditolak. Bisa diaktifkan nanti dari beranda.');
    else if (result === 'server-disabled')
      setPushMessage('Notifikasi belum aktif di server. Peringatan tetap muncul selama web ini terbuka.');
    else setPushMessage('Gagal mengaktifkan. Bisa dicoba lagi dari beranda.');
    return false;
  };

  return (
    <div className="grid w-full max-w-md gap-4">
      <div className="grid gap-2">
        <h1 className="text-3xl leading-tight font-black text-balance sm:text-4xl">
          Info bencana untuk wilayah Anda
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg">
          Status bahaya, langkah yang perlu dilakukan, dan peringatan darurat. Gratis, tanpa daftar, tanpa login.
        </p>
      </div>

      {/* 1. Location */}
      {location ? (
        <div className="flex items-start gap-3 rounded-2xl bg-lv-normal-soft p-4">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-lv-normal" />
          <div className="min-w-0">
            <p className="font-black">{locationFullName(location)}</p>
            <p className="text-sm text-foreground/75">
              {precision ? `Terdeteksi ${PRECISION_TEXT[precision]}, diperbarui otomatis saat Anda berpindah.` : 'Wilayah dipilih.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={detect}
            disabled={locating}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-lg font-black text-primary-foreground shadow-lg disabled:opacity-70"
          >
            {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            {locating ? 'Mendeteksi lokasi…' : 'Deteksi lokasi saya'}
          </button>
          <button
            type="button"
            onClick={() =>
              openPicker({
                onPicked: (picked) => {
                  setLocation(picked);
                  setAutoLocate(false);
                },
              })
            }
            className="text-sm font-extrabold text-primary"
          >
            atau pilih wilayah secara manual
          </button>
          {locateError && <p className="rounded-xl bg-lv-awas-soft px-3 py-2 text-sm font-bold text-lv-awas">{locateError}</p>}
          <p className="text-xs text-muted-foreground">
            Lokasi hanya dipakai untuk menentukan desa/kecamatan Anda dan tidak disimpan.
          </p>
        </div>
      )}

      {/* 2. Alarms — only once there's an area to file them under */}
      {location &&
        (pushEnabled ? (
          <p className="flex items-center gap-2 rounded-2xl bg-lv-normal-soft p-4 font-black text-lv-normal">
            <BellRing className="h-5 w-5" /> Peringatan darurat aktif
          </p>
        ) : support === 'ios-needs-install' ? (
          <div className="grid gap-1.5 rounded-2xl bg-muted p-4 text-sm">
            <p className="font-bold">Untuk peringatan darurat di iPhone/iPad:</p>
            <p className="flex items-center gap-2">
              Ketuk <Share className="h-4 w-4" /> Bagikan → <SquarePlus className="h-4 w-4" /> Tambahkan ke Layar Utama, lalu
              buka dari ikonnya.
            </p>
          </div>
        ) : support === 'supported' ? (
          <AlarmHoldButton label="Aktifkan peringatan darurat" onConfirm={enable} />
        ) : null)}
      {pushMessage && <p className="text-sm font-bold text-lv-awas">{pushMessage}</p>}

      <button
        type="button"
        onClick={onDone}
        className={cn(
          'rounded-2xl px-5 py-3.5 font-black',
          location ? 'border-2 border-primary text-primary hover:bg-accent' : 'text-muted-foreground hover:bg-accent',
        )}
      >
        {location ? 'Masuk ke beranda' : 'Lihat dulu tanpa mengatur'}
      </button>
    </div>
  );
}

/**
 * First-visit intro for the citizen portal: a ~9-second self-playing
 * animation (no "next" buttons) — Indonesia drawn from real district
 * points, real recent hazards pulsing, what AETHER does, the red alarm —
 * settling on a call to action: detect location, enable alarms.
 * Auto-plays until skipped or finished once (CitizenShell persists that);
 * replayable on request. Skip closes it straight into the portal;
 * reduced-motion jumps straight to the call to action.
 */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase(FINAL);
      return;
    }
    const timers = PHASES.slice(1).map((p, index) => window.setTimeout(() => setPhase(index + 1), p.at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const finished = phase === FINAL;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pengenalan AETHER Siaga"
      className="theme-dark fixed inset-0 isolate z-[60] overflow-y-auto bg-background font-citizen text-foreground [color-scheme:dark]"
    >
      {/* Always dark so the contour lines glow as in the React Bits demo. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <Topography />
      </div>
      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="flex h-12 items-center justify-between">
          <span className="text-sm font-black tracking-wide text-primary uppercase">AETHER Siaga</span>
          {!finished && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm font-extrabold text-muted-foreground hover:bg-accent"
            >
              Skip
            </button>
          )}
        </div>

        <div
          className={cn(
            'grid flex-1 items-center gap-8 py-4 transition-all duration-700 max-lg:content-center',
            finished && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-12',
          )}
        >
          {finished && (
            <div className="order-2 flex justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 lg:order-1">
              <CallToAction onDone={onClose} />
            </div>
          )}

          <div className={cn('relative order-1 w-full lg:order-2', !finished && 'mx-auto max-w-5xl')}>
            <IndonesiaDots showPulses={phase >= 1} dim={phase === 3} />
            <AlarmMoment show={phase === 3} />
          </div>

          {!finished && (
            <div className="relative order-3 mx-auto min-h-[7.5rem] w-full max-w-2xl" aria-live="polite">
              <Caption show={phase <= 1}>
                <p className="text-2xl leading-tight font-black text-balance sm:text-4xl">
                  Setiap hari, bencana terjadi di seluruh Indonesia.
                </p>
                <p className="text-muted-foreground">Titik berdenyut adalah kejadian terbaru yang tercatat.</p>
              </Caption>
              <Caption show={phase === 2}>
                <p className="text-2xl leading-tight font-black text-balance sm:text-4xl">
                  AETHER Siaga memantaunya untuk Anda.
                </p>
                <p className="text-muted-foreground">Gempa dari BMKG, titik api dari satelit, banjir, dan longsor.</p>
              </Caption>
              <Caption show={phase === 3}>
                <p className="text-2xl leading-tight font-black text-balance sm:text-4xl">
                  Dan memberi tahu Anda saat bahaya datang.
                </p>
                <p className="text-muted-foreground">Langsung ke perangkat Anda, walaupun web sedang ditutup.</p>
              </Caption>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

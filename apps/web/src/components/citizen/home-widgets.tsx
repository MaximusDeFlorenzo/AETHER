'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  ArrowUp,
  BellRing,
  BookOpen,
  ChevronDown,
  CloudRain,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Phone,
  Share,
  SquarePlus,
  Tent,
  Wind,
} from 'lucide-react';
import { usePublicWeather } from '@/hooks/use-public-alerts';
import { compassName, locationSummary } from '@/lib/citizen/geo';
import type { GuideKey } from '@/lib/citizen/guides';
import { disableAlarmPush, enableAlarmPush, getPushSupport, type PushSupport } from '@/lib/citizen/push';
import type { CitizenLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { SpringCheck } from '@/components/ui/spring-check';
import { AlarmHoldButton } from './alarm-hold-button';
import { useCitizenStore } from '@/stores/citizen-store';

export const card =
  'rounded-3xl border border-border/60 bg-card/90 p-5 shadow-[0_10px_30px_-18px_rgba(20,33,61,0.35)] backdrop-blur-sm';

const TASKS_PREVIEW = 3;

/** Ring that fills as steps are ticked off, with "done/total" in the middle. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const ratio = total ? done / total : 0;
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center" aria-hidden>
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="task-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--lv-normal)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--muted)" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="url(#task-ring)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="text-sm font-black tabular-nums">
        {done}
        <span className="text-muted-foreground">/{total}</span>
      </span>
    </span>
  );
}

export function TaskChecklist({ storageKey, tasks }: { storageKey: string; tasks: string[] }) {
  const ticks = useCitizenStore((state) => state.checklist[storageKey]);
  const toggle = useCitizenStore((state) => state.toggleChecklist);
  const [expanded, setExpanded] = useState(false);
  const done = tasks.filter((_, index) => ticks?.[index]).length;
  const left = tasks.length - done;
  const hidden = tasks.length - TASKS_PREVIEW;
  const shown = expanded || hidden <= 0 ? tasks : tasks.slice(0, TASKS_PREVIEW);
  // The first unticked step gets a nudge so there is always an obvious "do this next".
  const next = tasks.findIndex((_, index) => !ticks?.[index]);

  return (
    <section id="persiapan" className={cn(card, 'relative isolate grid scroll-mt-24 gap-4 overflow-hidden')}>
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-lv-normal-soft to-transparent" />

      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lv-normal-soft text-lv-normal ring-1 ring-lv-normal/20">
          <ListChecks className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-black">Yang perlu dilakukan</h2>
          <p className="text-sm text-muted-foreground">
            {done === 0
              ? 'Centang langkah yang sudah Anda lakukan.'
              : left > 0
                ? `Tinggal ${left} langkah lagi.`
                : 'Semua langkah sudah selesai.'}
          </p>
        </div>
        <ProgressRing done={done} total={tasks.length} />
      </div>

      <ol className="grid gap-2">
        {shown.map((task, index) => {
          const checked = !!ticks?.[index];
          const isNext = index === next;
          return (
            <li
              key={task}
              className={cn(
                'relative',
                index >= TASKS_PREVIEW && 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1',
              )}
            >
              <SpringCheck
                label={task}
                checked={checked}
                onChange={() => toggle(storageKey, index, tasks.length)}
                fillColor="var(--lv-normal)"
                color="var(--foreground)"
                checkColor="var(--card)"
                boxSize={26}
                boxRadius={8}
                fontSize={15}
                doneOpacity={0.5}
                className={cn(
                  'w-full items-start rounded-2xl border px-3 py-3 transition-colors',
                  checked
                    ? 'border-transparent bg-lv-normal-soft/60'
                    : isNext
                      ? 'border-primary/30 bg-accent/50 shadow-[0_6px_18px_-12px_var(--primary)] hover:bg-accent/70'
                      : 'border-border/60 bg-background hover:bg-accent/40',
                )}
              />
              {isNext && (
                <span className="pointer-events-none absolute -top-2 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-black tracking-wide text-primary-foreground uppercase">
                  Berikutnya
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-primary/30 text-sm font-extrabold text-primary transition-colors hover:border-primary/50 hover:bg-accent"
        >
          {expanded ? 'Tampilkan lebih sedikit' : `Lihat ${hidden} langkah lainnya`}
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', expanded && 'rotate-180')} />
        </button>
      )}
      {done === tasks.length && (
        <p className="rounded-2xl bg-lv-normal-soft px-3 py-2.5 text-sm font-extrabold text-lv-normal motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
          Mantap! Anda sudah siap. Pantau terus kabar dari kami.
        </p>
      )}
    </section>
  );
}

/** `row`: four stacked tiles across (phones). `grid`: 2×2 icon-beside-label tiles (sidebar). */
export function QuickActions({ guideKey, layout = 'row' }: { guideKey: GuideKey | null; layout?: 'row' | 'grid' }) {
  const items = [
    { href: '/darurat#posko', label: 'Posko terdekat', icon: Tent, tone: 'bg-lv-normal-soft text-lv-normal' },
    {
      href: guideKey ? `/panduan?jenis=${guideKey}` : '/panduan',
      label: 'Panduan',
      icon: BookOpen,
      tone: 'bg-accent text-primary',
    },
    { href: '/darurat', label: 'Telepon darurat', icon: Phone, tone: 'bg-lv-awas-soft text-lv-awas' },
    { href: '/peta', label: 'Peta', icon: MapIcon, tone: 'bg-lv-waspada-soft text-lv-waspada' },
  ];
  return (
    <nav aria-label="Aksi cepat" className={cn('grid gap-2', layout === 'grid' ? 'grid-cols-2 gap-2.5' : 'grid-cols-4')}>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            'group transition-[transform,border-color] duration-200 hover:-translate-y-0.5 active:scale-95',
            layout === 'grid'
              ? 'flex min-h-16 items-center gap-2.5 rounded-[18px] bg-background px-3 py-2.5 text-sm leading-tight font-extrabold'
              : 'grid content-start justify-items-center gap-2 rounded-[20px] border border-border/60 bg-card px-1 pt-3.5 pb-3 text-center text-xs leading-tight font-extrabold hover:border-primary/30 sm:text-sm',
          )}
        >
          <span
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:rotate-[-4deg]',
              item.tone,
            )}
          >
            <item.icon className="h-5 w-5" />
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

// BMKG's hourly scale: 10 mm/jam and up is "hujan lebat".
const HEAVY_RAIN_MM = 10;

/** Open-Meteo's next 12 hours of rain for the district, with the heavy-rain line drawn in. */
export function RainForecastCard({ location }: { location: CitizenLocation }) {
  const { data, isLoading } = usePublicWeather(location.districtId);

  if (isLoading) {
    return (
      <section className={cn(card, 'flex items-center gap-3 text-sm text-muted-foreground')}>
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat prakiraan hujan…
      </section>
    );
  }
  const hours = data?.hourly ?? [];
  if (!hours.length) return null;

  const heavy = hours.filter((hour) => hour.precipitationMm >= HEAVY_RAIN_MM);
  const rainy = hours.filter((hour) => hour.precipitationMm >= 0.5);
  const peak = Math.max(...hours.map((hour) => hour.precipitationMm));
  // Scale to the wetter of the forecast or a little past the heavy line, so a
  // dry day doesn't stretch 0,3 mm into a towering bar.
  const top = Math.max(peak, HEAVY_RAIN_MM * 1.4);
  const mm = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  const summary = heavy.length
    ? `${heavy.length} jam hujan lebat, mulai pukul ${format(new Date(heavy[0].time), 'HH.mm')}.`
    : rainy.length
      ? `Hujan ringan sampai sedang, puncak ${mm(peak)} mm/jam.`
      : 'Tidak ada hujan berarti.';

  return (
    <section className={cn(card, 'grid gap-4')}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-primary">
          <CloudRain className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-black">Hujan 12 jam ke depan</h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
      </div>

      <div className="relative" role="img" aria-label={`Prakiraan hujan per jam. ${summary}`}>
        <div
          aria-hidden
          className="absolute inset-x-0 border-t-[1.5px] border-dashed border-lv-siaga/50"
          style={{ bottom: `calc(1.5rem + ${(HEAVY_RAIN_MM / top) * 100}% * (8 / 9.5))` }}
        >
          <span className="absolute -top-5 right-0 rounded bg-card px-1 font-mono text-[10px] text-muted-foreground">
            lebat ≥ {HEAVY_RAIN_MM} mm/jam
          </span>
        </div>
        <div className="grid h-38 grid-cols-12 items-end gap-1.5">
          {hours.slice(0, 12).map((hour) => (
            <div key={hour.time} className="grid h-full content-end justify-items-center gap-1.5">
              <span
                title={`${mm(hour.precipitationMm)} mm/jam`}
                className={cn(
                  'w-full max-w-6 rounded-t-lg rounded-b-sm transition-[height] duration-500',
                  hour.precipitationMm >= HEAVY_RAIN_MM ? 'bg-lv-siaga' : 'bg-primary/80',
                )}
                style={{ height: `${Math.max(3, (hour.precipitationMm / top) * 100) * (8 / 9.5)}%` }}
              />
              <span className="font-mono text-[10px] text-muted-foreground">{format(new Date(hour.time), 'HH')}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Perkiraan Open-Meteo di titik pusat kabupaten/kota, dalam mm per jam.</p>
    </section>
  );
}

export function WindCard({ location }: { location: CitizenLocation }) {
  const { data, isLoading } = usePublicWeather(location.districtId);

  if (isLoading) {
    return (
      <section className={cn(card, 'flex items-center gap-3 text-sm text-muted-foreground')}>
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat arah angin…
      </section>
    );
  }
  if (!data) return null;

  const toward = (data.windFromDeg + 180) % 360;
  const slots = data.hourly.filter((_, index) => index % 3 === 2).slice(0, 4);

  const peak = Math.max(...slots.map((slot) => slot.windSpeedKmh), 1);

  return (
    <section className={cn(card, 'grid gap-4')}>
      <div className="flex items-center gap-4">
        <span className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full bg-accent/60 ring-1 ring-border text-primary">
          {(['U', 'T', 'S', 'B'] as const).map((label, index) => (
            <span
              key={label}
              aria-hidden
              className={cn(
                'absolute text-[10px] font-black text-muted-foreground',
                ['top-1', 'right-1.5', 'bottom-1', 'left-1.5'][index],
              )}
            >
              {label}
            </span>
          ))}
          <ArrowUp className="h-9 w-9 transition-transform duration-700" style={{ transform: `rotate(${toward}deg)` }} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-[0.1em] text-muted-foreground uppercase">
            <Wind className="h-3.5 w-3.5" /> Angin sekarang
          </p>
          <h2 className="text-lg leading-tight font-black">
            Dari {compassName(data.windFromDeg)}, {Math.round(data.windSpeedKmh)} km/jam
          </h2>
          <p className="text-sm text-muted-foreground">
            Asap atau abu di sekitar {locationSummary(location)} akan terbawa ke arah{' '}
            <strong className="text-foreground">{compassName(toward)}</strong>.
          </p>
        </div>
      </div>
      {slots.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {slots.map((slot) => (
            <div key={slot.time} className="grid justify-items-center gap-1.5 rounded-2xl bg-background px-1 py-2.5 text-center">
              <span className="text-xs font-extrabold text-muted-foreground">{format(new Date(slot.time), 'HH.mm')}</span>
              <span className="flex h-10 w-2 items-end overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="w-full rounded-full bg-cyan transition-[height] duration-500"
                  style={{ height: `${Math.max(12, (slot.windSpeedKmh / peak) * 100)}%` }}
                />
              </span>
              <ArrowUp
                className="h-3.5 w-3.5 text-primary"
                style={{ transform: `rotate(${(slot.windFromDeg + 180) % 360}deg)` }}
                aria-label={`angin dari ${compassName(slot.windFromDeg)}`}
              />
              <span className="text-xs font-black">{Math.round(slot.windSpeedKmh)} km/j</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Perkiraan Open-Meteo di titik pusat kabupaten/kota. Panah = arah angin bertiup.</p>
    </section>
  );
}

export function AlarmEnableCard({ location }: { location: CitizenLocation }) {
  const pushEnabled = useCitizenStore((state) => state.pushEnabled);
  const setPushEnabled = useCitizenStore((state) => state.setPushEnabled);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setSupport(getPushSupport()), []);

  const enable = async () => {
    setMessage(null);
    const result = await enableAlarmPush(location);
    setSupport(getPushSupport());
    if (result === 'enabled') {
      setPushEnabled(true);
      return true;
    }
    if (result === 'denied')
      setMessage('Izin notifikasi ditolak. Buka pengaturan situs di browser, izinkan notifikasi, lalu coba lagi.');
    else if (result === 'server-disabled')
      setMessage('Notifikasi belum diaktifkan di server. Peringatan tetap muncul selama halaman ini terbuka.');
    else setMessage('Gagal mengaktifkan. Periksa sinyal lalu coba lagi.');
    return false;
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableAlarmPush();
    } finally {
      setPushEnabled(false);
      setBusy(false);
    }
  };

  if (pushEnabled) {
    return (
      <section className="theme-dark grid gap-3 rounded-3xl bg-navy p-5 text-foreground shadow-[0_16px_36px_-24px_rgba(8,27,58,0.9)]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-lv-normal-soft text-lv-normal">
            <BellRing className="h-5 w-5" />
          </span>
          <p className="flex-1 font-black text-white">Peringatan darurat aktif</p>
          <span className="h-2.5 w-2.5 rounded-full bg-lv-normal shadow-[0_0_0_4px_var(--lv-normal-soft)]" aria-hidden />
        </div>
        <p className="text-sm text-white/75">
          Untuk {locationSummary(location)}. Perangkat ini akan berbunyi walaupun web ditutup, selama browser tidak dimatikan
          paksa.
        </p>
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="h-11 rounded-2xl text-sm font-extrabold text-white ring-1 ring-white/20 transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          Matikan peringatan
        </button>
      </section>
    );
  }

  return (
    <section className={cn(card, 'grid gap-3 border-2 border-lv-awas/60')}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-lv-awas-soft text-lv-awas">
          <BellRing className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-black">Aktifkan peringatan darurat</h2>
          <p className="text-sm text-muted-foreground">
            Saat bahaya mencapai level tertinggi, perangkat ini berbunyi dan menampilkan layar merah berisi langkah penyelamatan,
            walaupun web ini tidak sedang dibuka.
          </p>
        </div>
      </div>

      {support === 'ios-needs-install' ? (
        <div className="grid gap-2 rounded-2xl bg-background p-3 text-sm">
          <p className="font-bold">Di iPhone/iPad, tambahkan dulu ke Layar Utama:</p>
          <ol className="grid gap-1.5">
            <li className="flex items-center gap-2">
              1. Ketuk <Share className="h-4 w-4" /> <strong>Bagikan</strong> di Safari
            </li>
            <li className="flex items-center gap-2">
              2. Pilih <SquarePlus className="h-4 w-4" /> <strong>Tambahkan ke Layar Utama</strong>
            </li>
            <li>3. Buka AETHER dari ikon di Layar Utama, lalu aktifkan di sini.</li>
          </ol>
        </div>
      ) : support === 'unsupported' ? (
        <p className="rounded-2xl bg-background p-3 text-sm">
          Browser ini belum mendukung notifikasi. Peringatan tetap muncul selama halaman ini terbuka. Coba Chrome di Android
          untuk menerima peringatan saat web ditutup.
        </p>
      ) : support === 'denied' ? (
        <p className="rounded-2xl bg-background p-3 text-sm">
          Notifikasi diblokir untuk situs ini. Buka pengaturan situs di browser, ubah Notifikasi menjadi “Izinkan”, lalu muat
          ulang halaman.
        </p>
      ) : support === null ? null : (
        <AlarmHoldButton label={`Aktifkan untuk ${locationSummary(location)}`} onConfirm={enable} />
      )}
      {message && <p className="text-sm font-bold text-lv-awas">{message}</p>}
    </section>
  );
}

export const EMERGENCY_NUMBERS = [
  { number: '112', label: 'Panggilan darurat', note: 'Gratis, 24 jam, semua keadaan darurat' },
  { number: '117', label: 'BNPB', note: 'Informasi dan bantuan bencana' },
  { number: '115', label: 'Basarnas', note: 'Pencarian dan pertolongan (SAR)' },
  { number: '119', label: 'Ambulans', note: 'Layanan gawat darurat kesehatan' },
  { number: '113', label: 'Pemadam kebakaran', note: 'Kebakaran dan penyelamatan' },
  { number: '110', label: 'Polisi', note: 'Keamanan dan ketertiban' },
];

export function EmergencyNumbers({ compact = false }: { compact?: boolean }) {
  const [main, ...rest] = EMERGENCY_NUMBERS;
  const others = compact ? rest.slice(0, 4) : rest;
  return (
    <div className="grid gap-2.5">
      <a
        href={`tel:${main.number}`}
        className="citizen-lift flex items-center gap-3 rounded-[22px] bg-alarm px-4 py-3.5 text-white shadow-[0_14px_30px_-16px_var(--alarm)]"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15">
          <Phone className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-black">{main.label}</span>
          <span className="block truncate text-xs text-white/85">{main.note}</span>
        </span>
        <span className="text-3xl font-black tracking-tight tabular-nums">{main.number}</span>
      </a>
      <ul className={cn('grid grid-cols-2 gap-2.5', !compact && 'lg:grid-cols-3')}>
        {others.map((item) => (
          <li key={item.number}>
            <a
              href={`tel:${item.number}`}
              className="citizen-lift grid h-full gap-0.5 rounded-[18px] border border-border/60 bg-card/90 px-3.5 py-3 hover:border-lv-awas/40"
            >
              <span className="text-2xl font-black text-lv-awas tabular-nums">{item.number}</span>
              <span className="text-sm leading-tight font-extrabold">{item.label}</span>
              {!compact && <span className="text-xs text-muted-foreground">{item.note}</span>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { BellRing, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { useLocationPicker } from '@/components/citizen/citizen-shell';
import {
  AlarmEnableCard,
  EmergencyNumbers,
  QuickActions,
  RainForecastCard,
  TaskChecklist,
  WindCard,
  card,
} from '@/components/citizen/home-widgets';
import { AirQualityCard } from '@/components/citizen/air-quality-card';
import { AlarmHoldButton } from '@/components/citizen/alarm-hold-button';
import { FamilyAreas } from '@/components/citizen/family-areas';
import { InstallAppButton } from '@/components/citizen/install-app-button';
import { openInstallPrompt } from '@/components/citizen/install-prompt';
import { IndonesiaEventMap, type MapSelection } from '@/components/citizen/indonesia-event-map';
import { NationalEventCard } from '@/components/citizen/national-event-card';
import { PageContainer, SectionTitle } from '@/components/citizen/page-container';
import { SmokeAdvisory, useSmokeAdvisory } from '@/components/citizen/smoke-advisory';
import { StatusHero } from '@/components/citizen/status-hero';
import { Skeleton } from '@/components/ui/skeleton';
import { useNationalEvents } from '@/hooks/use-national-events';
import { usePublicWeather } from '@/hooks/use-public-alerts';
import { useRegionStatus } from '@/hooks/use-region-status';
import { locationLatLng, locationSummary } from '@/lib/citizen/geo';
import { enableAlarmPush, getPushSupport, type PushSupport } from '@/lib/citizen/push';
import { statusTasks } from '@/lib/citizen/status';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';

// WebGL-only and ~60 KB, so it loads after the hero instead of blocking it.
const Topography = dynamic(() => import('@/components/shared/topography'), { ssr: false });

function greeting(hour: number) {
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function NationalPreview() {
  const location = useCitizenStore((state) => state.location);
  const weather = usePublicWeather(location?.districtId);
  const { events, isLoading, isError } = useNationalEvents(location, weather.data);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const clearSelection = useCallback(() => setSelection(null), []);

  // Near-to-me and smoke-toward-me first, then the rest by recency.
  const sorted = [...events].sort(
    (a, b) =>
      Number(b.proximity.near || b.smokeTowardUser) - Number(a.proximity.near || a.smokeTowardUser) ||
      new Date(b.event.eventTime).getTime() - new Date(a.event.eventTime).getTime(),
  );
  // At most two per hazard type, so a day of 1,500 fire hotspots doesn't
  // crowd an earthquake or flood out of the preview.
  const perType = new Map<string, number>();
  const preview = sorted
    .filter((item) => {
      const count = perType.get(item.event.hazardType) ?? 0;
      perType.set(item.event.hazardType, count + 1);
      return count < 2;
    })
    .slice(0, 6);

  return (
    <section>
      <SectionTitle
        action={
          <Link href="/indonesia" className="text-sm font-extrabold text-primary">
            Lihat semua
          </Link>
        }
      >
        Indonesia hari ini
      </SectionTitle>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-32 rounded-3xl" />
          ))}
        </div>
      ) : isError ? (
        <p className={cn(card, 'text-sm text-muted-foreground')}>Kabar nasional belum bisa dimuat. Coba lagi sebentar.</p>
      ) : preview.length === 0 ? (
        <p className={cn(card, 'text-sm text-muted-foreground')}>
          Tidak ada kejadian bencana tercatat di Indonesia dalam 24 jam terakhir.
        </p>
      ) : (
        <div className="grid gap-3">
          <IndonesiaEventMap items={events} selection={selection} onClose={clearSelection} />
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
            {preview.map((item) => (
              <div key={item.event.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
                <NationalEventCard
                  item={item}
                  compact
                  selected={selection?.event.id === item.event.id}
                  onSelect={() => setSelection({ event: item.event, key: `${item.event.id}-${Date.now()}` })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const WELCOME_POINTS = [
  { icon: ShieldCheck, text: 'Status bahaya wilayah Anda' },
  { icon: BellRing, text: 'Peringatan darurat' },
];

function Welcome() {
  const { openPicker } = useLocationPicker();
  const setLocation = useCitizenStore((state) => state.setLocation);
  const setPushEnabled = useCitizenStore((state) => state.setPushEnabled);
  const [pushSupport, setPushSupport] = useState<PushSupport | null>(null);

  useEffect(() => setPushSupport(getPushSupport()), []);

  // Alarms are filed under an area, so the hold opens the picker first and
  // turns them on once an area is chosen. Resolves false right away so the
  // button rewinds instead of spinning while the picker is open.
  const enableAlarms = async () => {
    openPicker({
      title: 'Peringatan darurat untuk wilayah…',
      onPicked: (picked) => {
        setLocation(picked);
        void enableAlarmPush(picked).then((result) => {
          if (result === 'enabled') setPushEnabled(true);
        });
      },
    });
    return false;
  };
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-navy-dark via-navy to-primary p-5 text-white sm:rounded-[32px] shadow-[0_24px_60px_-30px_rgba(16,42,86,0.8)] sm:p-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:linear-gradient(to_left,black,transparent_75%)]">
        <Topography color="#43c6d5" lineCount={26} speed={0.15} glow={0.4} hoverEffect="light" clickEffect="none" />
      </div>
      <div aria-hidden className="absolute -top-24 -right-24 -z-10 h-72 w-72 rounded-full bg-cyan/30 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 left-1/3 -z-10 h-72 w-72 rounded-full bg-primary/40 blur-3xl" />

      <InstallAppButton className="absolute top-4 right-4 sm:top-6 sm:right-6" />

      <div className="grid gap-5 sm:gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid gap-3 sm:gap-4">
          <h1 className="pr-11 text-2xl sm:pr-14 leading-[1.1] font-black tracking-tight text-balance sm:text-5xl">
            Info bencana untuk{' '}
            <span className="bg-gradient-to-r from-cyan to-white bg-clip-text text-transparent">wilayah Anda</span>
          </h1>
          <p className="max-w-xl text-sm text-white/80 sm:text-lg">
            Pilih kabupaten/kota Anda untuk melihat status bahaya, apa yang perlu dilakukan, dan menerima peringatan darurat.
          </p>
          <ul className="flex flex-wrap gap-1.5 sm:gap-2">
            {WELCOME_POINTS.map((point) => (
              <li
                key={point.text}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold ring-1 ring-white/10 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                <point.icon className="h-4 w-4 text-cyan" /> {point.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid justify-items-center gap-3 sm:gap-5">
          <span aria-hidden className="citizen-float relative hidden h-36 w-36 place-items-center lg:grid">
            <span className="citizen-radar absolute inset-6 rounded-full text-cyan" />
            <span className="absolute inset-0 rounded-full border border-white/15" />
            <span className="absolute inset-4 rounded-full border border-white/20" />
            <span className="relative grid h-20 w-20 place-items-center rounded-full bg-white/15 ring-1 ring-white/30 backdrop-blur">
              <MapPin className="h-9 w-9 text-white" />
            </span>
          </span>
          <button
            type="button"
            onClick={() => openPicker()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3 text-base font-black sm:py-4 sm:text-lg text-navy shadow-[0_12px_30px_-10px_rgba(67,198,213,0.7)] transition-transform hover:-translate-y-0.5 active:translate-y-0 sm:w-80"
          >
            <MapPin className="h-5 w-5 text-primary" /> Pilih wilayah saya
          </button>
          {pushSupport === 'ios-needs-install' ? (
            // iPhone needs AETHER on the Home Screen first; the install modal explains how.
            <AlarmHoldButton
              label="Aktifkan peringatan darurat"
              onConfirm={async () => {
                openInstallPrompt();
                return false;
              }}
              onDark
              className="w-full sm:w-80"
            />
          ) : (
            <AlarmHoldButton label="Aktifkan peringatan darurat" onConfirm={enableAlarms} onDark className="w-full sm:w-80" />
          )}
        </div>
      </div>
    </section>
  );
}

export default function CitizenHomePage() {
  const hasHydrated = useCitizenStore((state) => state.hasHydrated);
  const location = useCitizenStore((state) => state.location);
  const { status, isLoading, isError } = useRegionStatus(location);
  const smoke = useSmokeAdvisory(location);
  const [hour, setHour] = useState<number | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Client clock only — the server's hour would mismatch on hydration.
  useEffect(() => {
    const now = new Date();
    setHour(now.getHours());
    setToday(now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }));
  }, []);


  if (!hasHydrated) {
    return (
      <PageContainer>
        <Skeleton className="h-72 rounded-[28px]" />
      </PageContainer>
    );
  }

  if (!location) {
    return (
      <PageContainer className="grid gap-8">
        <Welcome />
        <NationalPreview />
        <section>
          <SectionTitle>Nomor darurat</SectionTitle>
          <EmergencyNumbers />
        </section>
      </PageContainer>
    );
  }

  const areaName = locationSummary(location);
  const userPoint = locationLatLng(location);

  return (
    <PageContainer>
      <div className="mb-4 flex items-center gap-3 sm:mb-6">
        <span
          aria-hidden
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-cyan text-white shadow-[0_8px_20px_-8px_var(--primary)]"
        >
          <MapPin className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-muted-foreground">
            {hour !== null ? greeting(hour) : ' '}
            {today && <span className="hidden sm:inline"> · {today}</span>}
          </p>
          <p className="truncate text-xl font-black tracking-tight sm:text-2xl">Warga {areaName}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start lg:gap-7 2xl:grid-cols-[minmax(0,1fr)_420px] 2xl:gap-8">
        <div className="grid min-w-0 gap-5 lg:gap-7">
          {isLoading || !status ? (
            isError ? (
              <p className={cn(card, 'text-muted-foreground')}>
                Status wilayah belum bisa dimuat. Periksa sinyal Anda. Jika keadaan darurat, hubungi 112.
              </p>
            ) : (
              <div className={cn(card, 'flex items-center gap-3 text-muted-foreground')}>
                <Loader2 className="h-5 w-5 animate-spin" /> Memeriksa status {areaName}…
              </div>
            )
          ) : (
            <StatusHero status={status} areaName={areaName} point={location.point} smokeNearby={!!smoke} />
          )}
          {smoke && <SmokeAdvisory advisory={smoke} />}
          {/* Phones get the quick actions right under the status; wide
              screens show them in the sidebar card instead. */}
          <div className="lg:hidden">
            <QuickActions guideKey={status?.guideKey ?? null} />
          </div>
          <RainForecastCard location={location} />
          {/* On wide screens the checklist and family card sit side by side. */}
          <div className="grid gap-5 lg:gap-7 xl:grid-cols-2 xl:items-start">
            {status && (
              <TaskChecklist {...statusTasks(status, { smoke: smoke?.kind === 'toward' })} />
            )}
            <FamilyAreas />
          </div>
          <NationalPreview />
        </div>

        <aside className="grid gap-5 md:grid-cols-2 lg:grid-cols-1 lg:gap-6">
          <AlarmEnableCard location={location} />
          <div className={cn(card, 'hidden lg:grid lg:gap-3')}>
            <h2 className="text-sm font-black tracking-wide text-muted-foreground uppercase">Aksi cepat</h2>
            <QuickActions guideKey={status?.guideKey ?? null} layout="grid" />
          </div>
          {userPoint && (
            <AirQualityCard point={userPoint} title="Kualitas udara" subtitle={`Di sekitar ${areaName}`} withStation />
          )}
          <WindCard location={location} />
          <section className="md:col-span-2 lg:col-span-1">
            <SectionTitle
              action={
                <Link href="/darurat" className="text-sm font-extrabold text-primary">
                  Semua
                </Link>
              }
            >
              Nomor darurat
            </SectionTitle>
            <EmergencyNumbers compact />
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}

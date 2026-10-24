'use client';

import { use, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { ChevronLeft, Info } from 'lucide-react';
import { card } from '@/components/citizen/home-widgets';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import { LevelBadge } from '@/components/citizen/level-badge';
import { PageContainer, SectionTitle } from '@/components/citizen/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { useAffectedPopulation, useAffectedRegions, useHazardEvent } from '@/hooks/use-hazard-events';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { eventFact, eventTitle, roundPopulation, sourceLabel, timeAgo, tsunamiPotential } from '@/lib/citizen/events';
import { distanceKm, formatDistance, locationLatLng, locationSummary, proximityLabel } from '@/lib/citizen/geo';
import { GUIDES, guideKeyForHazardType } from '@/lib/citizen/guides';
import { exposureToLevel, HAZARD_LABEL_ID, isRecent, LEVEL_META, levelRank } from '@/lib/citizen/status';
import type { CitizenLevel } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';

// react-leaflet touches `window` at import time — client-only, as on /peta.
const CitizenMap = dynamic(() => import('@/components/citizen/citizen-map').then((mod) => mod.CitizenMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[inherit]" />,
});

export default function CitizenEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const location = useCitizenStore((state) => state.location);
  const event = useHazardEvent(id);
  const regions = useAffectedRegions(id);
  const assessments = useRiskAssessments({ hazardEventId: id, limit: 100 });
  const population = useAffectedPopulation(id);

  const levelByDistrict = useMemo(() => {
    const map = new Map<string, { level: CitizenLevel }>();
    for (const assessment of assessments.data?.data ?? []) {
      if (assessment.status !== 'completed') continue;
      map.set(assessment.district.id, { level: exposureToLevel(assessment.exposureLevel) });
    }
    return map;
  }, [assessments.data]);

  const overall = useMemo<CitizenLevel>(() => {
    let worst: CitizenLevel = 'normal';
    for (const { level } of levelByDistrict.values()) if (levelRank(level) > levelRank(worst)) worst = level;
    return worst;
  }, [levelByDistrict]);

  if (event.isLoading) {
    return (
      <PageContainer className="grid gap-4">
        <Skeleton className="h-56 rounded-[28px]" />
        <Skeleton className="h-40 rounded-3xl" />
      </PageContainer>
    );
  }

  if (event.isError || !event.data) {
    return (
      <PageContainer>
        <p className={cn(card, 'text-muted-foreground')}>Kejadian ini tidak ditemukan.</p>
      </PageContainer>
    );
  }

  const data = event.data;
  const meta = LEVEL_META[overall];
  const guide = GUIDES[guideKeyForHazardType(data.hazardType)];
  const ongoing = isRecent(data.eventTime);
  const tsunami = tsunamiPotential(data);
  const fact = eventFact(data);
  const sortedRegions = [...(regions.data ?? [])].sort((a, b) => a.distanceKm - b.distanceKm);
  const userPoint = locationLatLng(location);
  const km = userPoint ? distanceKm(userPoint.lat, userPoint.lng, data.latitude, data.longitude) : null;
  const mapEvent = { event: data, km, proximity: proximityLabel(km), smokeTowardUser: false };
  const mine = location ? sortedRegions.find((region) => region.district.id === location.districtId) : undefined;
  const estimate = population.data;
  const partialCoverage = estimate && estimate.villagesWithPopulation < estimate.totalVillages;

  return (
    <PageContainer>
      <Link href="/indonesia" className="mb-4 inline-flex items-center gap-1 text-sm font-extrabold text-primary">
        <ChevronLeft className="h-4 w-4" /> Indonesia hari ini
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section className={cn('rounded-[28px] p-5 sm:p-7', meta.soft)}>
            <div className="flex items-start gap-4">
              <div className="grid min-w-0 flex-1 gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <LevelBadge level={overall} label={`${meta.label}${ongoing ? ' · masih berlangsung' : ''}`} className="bg-card/80 dark:bg-white/10" />
                </span>
                <h1 className="text-2xl leading-tight font-black text-balance sm:text-3xl">{eventTitle(data)}</h1>
                <p className="text-sm font-semibold text-foreground/75">
                  {format(new Date(data.eventTime), "EEEE, d MMMM yyyy · HH.mm 'WIB'", { locale: localeId })} (
                  {timeAgo(data.eventTime)}) · Sumber: {sourceLabel(data.source)}
                </p>
              </div>
              <span className={cn('grid h-16 w-16 shrink-0 place-items-center rounded-full bg-card/80 dark:bg-white/10', meta.text)}>
                <HazardIcon hazardType={data.hazardType} className="h-8 w-8" />
              </span>
            </div>
            {tsunami !== null && (
              <p
                className={cn(
                  'mt-4 rounded-2xl px-4 py-3 font-black',
                  tsunami ? 'bg-lv-awas text-white' : 'bg-card/80 text-lv-normal dark:bg-white/10',
                )}
              >
                {tsunami
                  ? 'Berpotensi tsunami. Warga pesisir segera menjauh dari pantai ke tempat tinggi.'
                  : 'Tidak berpotensi tsunami menurut BMKG.'}
              </p>
            )}
          </section>

          <section className="grid gap-2">
            <div className={cn(card, 'relative h-72 overflow-hidden p-0 sm:h-96')}>
              <CitizenMap
                events={[mapEvent]}
                user={userPoint && location ? { ...userPoint, label: locationSummary(location) } : null}
                shelters={[]}
                alerts={[]}
                focus={{ lat: data.latitude, lng: data.longitude, zoom: 7, key: data.id }}
              />
            </div>
            <p className="text-xs font-bold text-muted-foreground">
              Peta lokasi kejadian{userPoint ? ' dan wilayah Anda' : ''}. Ketuk titik untuk keterangan.
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={cn(card, 'p-4')}>
              <p className="text-2xl font-black tabular-nums">
                {population.isLoading ? '…' : estimate?.totalPopulation != null ? `± ${roundPopulation(estimate.totalPopulation)}` : '–'}
              </p>
              <p className="text-xs font-bold text-muted-foreground">
                perkiraan warga terdampak{estimate ? ` (radius ${estimate.radiusKm} km)` : ''}
              </p>
            </div>
            <div className={cn(card, 'p-4')}>
              <p className="text-2xl font-black tabular-nums">
                {population.isLoading ? '…' : (estimate?.totalVillages.toLocaleString('id-ID') ?? '–')}
              </p>
              <p className="text-xs font-bold text-muted-foreground">kelurahan/desa di sekitar</p>
            </div>
            <div className={cn(card, 'p-4')}>
              <p className="text-lg leading-tight font-black">{HAZARD_LABEL_ID[data.hazardType]}</p>
              <p className="text-xs font-bold text-muted-foreground">jenis kejadian</p>
            </div>
            <div className={cn(card, 'p-4')}>
              <p className="text-lg leading-tight font-black">{fact ?? '–'}</p>
              <p className="text-xs font-bold text-muted-foreground">keterangan</p>
            </div>
          </section>

          {estimate && estimate.nearestVillages.length > 0 && (
            <section>
              <SectionTitle>Kelurahan/desa terdekat</SectionTitle>
              <ul className={cn(card, 'divide-y divide-border/70 p-2 sm:p-3')}>
                {estimate.nearestVillages.map((village) => (
                  <li key={village.villageId} className="flex items-center justify-between gap-3 px-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold">{village.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Kec. {village.subdistrictName}, {village.districtName} · ± {formatDistance(village.distanceKm)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-black tabular-nums">
                      {village.population !== null ? (
                        <>
                          {village.population.toLocaleString('id-ID')}
                          <span className="block text-[11px] font-bold text-muted-foreground">jiwa</span>
                        </>
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground">belum ada data</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Perkiraan warga terdampak dijumlahkan dari penduduk tiap kelurahan/desa yang titik pusatnya dalam radius{' '}
                  {estimate.radiusKm} km dari lokasi kejadian
                  {estimate.sourceName ? ` (sumber: ${estimate.sourceName}${estimate.periodYear ? ` ${estimate.periodYear}` : ''})` : ''}.
                  {partialCoverage &&
                    ` Data penduduk baru tersedia untuk ${estimate.villagesWithPopulation.toLocaleString('id-ID')} dari ${estimate.totalVillages.toLocaleString('id-ID')} kelurahan/desa (${estimate.coveragePercentage.toLocaleString('id-ID')}%), jadi angka sebenarnya bisa lebih besar.`}
                </span>
              </p>
            </section>
          )}

          <section>
            <SectionTitle>Cek wilayah Anda</SectionTitle>
            {mine && (
              <p className="mb-3 rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">
                Wilayah Anda ({mine.district.name}) berjarak ± {formatDistance(mine.distanceKm)} dari kejadian ini.
              </p>
            )}
            {regions.isLoading ? (
              <Skeleton className="h-40 rounded-3xl" />
            ) : sortedRegions.length === 0 ? (
              <p className={cn(card, 'text-sm text-muted-foreground')}>Belum ada wilayah terdampak yang tercatat.</p>
            ) : (
              <ul className={cn(card, 'divide-y divide-border/70 p-2 sm:p-3')}>
                {sortedRegions.map((region) => {
                  const entry = levelByDistrict.get(region.district.id);
                  return (
                    <li
                      key={region.id}
                      className={cn(
                        'flex items-center justify-between gap-3 px-3 py-3',
                        region.district.id === location?.districtId && 'rounded-2xl bg-accent/60',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-extrabold">{region.district.name}</span>
                        <span className="block text-xs text-muted-foreground">± {formatDistance(region.distanceKm)} dari lokasi kejadian</span>
                      </span>
                      {entry ? <LevelBadge level={entry.level} /> : <span className="text-xs text-muted-foreground">Dinilai…</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid gap-5 lg:sticky lg:top-24">
          <section className={cn(card, 'grid gap-3')}>
            <h2 className="text-lg font-black">Yang perlu dilakukan</h2>
            <ol className="grid gap-2">
              {(ongoing ? guide.during : guide.after).slice(0, 4).map((tip, index) => (
                <li key={tip} className="flex gap-3 text-[15px]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-black text-primary">
                    {index + 1}
                  </span>
                  {tip}
                </li>
              ))}
            </ol>
            <Link href={`/panduan?jenis=${guide.key}`} className="text-sm font-extrabold text-primary">
              Panduan lengkap {guide.noun} →
            </Link>
          </section>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Ringkasan otomatis dari data pemantauan. Jika ada instruksi dari BPBD atau petugas di lapangan, ikuti instruksi
            tersebut.
          </p>
        </aside>
      </div>
    </PageContainer>
  );
}

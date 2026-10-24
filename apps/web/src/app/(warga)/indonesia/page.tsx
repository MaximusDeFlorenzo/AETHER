'use client';

import Link from 'next/link';
import { ChevronRight, CloudFog, Users } from 'lucide-react';
import { card } from '@/components/citizen/home-widgets';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import { HAZARD_TONE, NationalEventCard } from '@/components/citizen/national-event-card';
import { PageContainer, PageHeading, SectionTitle } from '@/components/citizen/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { NATIONAL_ORDER, useNationalEvents } from '@/hooks/use-national-events';
import { usePublicWeather } from '@/hooks/use-public-alerts';
import { timeAgo } from '@/lib/citizen/events';
import { HAZARD_LABEL_ID } from '@/lib/citizen/status';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import type { HazardType, WildfireDetails } from '@/types/domain';

const WILDFIRE_LISTED = 12;

const GROUP_SOURCE: Record<HazardType, string> = {
  earthquake: 'Sumber: BMKG',
  flood: 'Sumber: sensor & laporan banjir',
  wildfire: 'Sumber: satelit NASA FIRMS (MODIS + VIIRS)',
  landslide: 'Sumber: curah hujan & kondisi tanah',
};

export default function NationalPage() {
  const location = useCitizenStore((state) => state.location);
  const weather = usePublicWeather(location?.districtId);
  const { byType, totals, events, isLoading, isError, hotspotMap } = useNationalEvents(location, weather.data);
  const latestSatellite = hotspotMap?.sensors.reduce<string | null>(
    (latest, s) => (!latest || s.latestObservedAt > latest ? s.latestObservedAt : latest),
    null,
  );

  return (
    <PageContainer>
      <PageHeading
        title="Indonesia hari ini"
        description="Kejadian bencana di seluruh Indonesia dalam 24 jam terakhir, dikelompokkan per jenis. Setiap kejadian diberi label apakah dekat atau berdampak ke wilayah Anda."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {NATIONAL_ORDER.map((type) => (
          <div key={type} className={cn(card, 'flex items-center gap-3 p-4')}>
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-2xl', HAZARD_TONE[type])}>
              <HazardIcon hazardType={type} className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-2xl leading-none font-black tabular-nums">
                {isLoading ? '–' : (totals.get(type) ?? 0).toLocaleString('id-ID')}
              </span>
              <span className="text-xs font-bold text-muted-foreground">
                {HAZARD_LABEL_ID[type]}
                {type === 'wildfire' && ' (area titik api)'}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="grid min-w-0 gap-7">
          {isLoading && (
            <div className="grid gap-3">
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} className="h-24 rounded-3xl" />
              ))}
            </div>
          )}
          {isError && (
            <p className={cn(card, 'text-muted-foreground')}>Data nasional belum bisa dimuat. Coba lagi sebentar.</p>
          )}
          {!isLoading && !isError && events.length === 0 && (
            <p className={cn(card, 'text-muted-foreground')}>
              Tidak ada kejadian bencana tercatat dalam 24 jam terakhir.
            </p>
          )}
          {NATIONAL_ORDER.map((type) => {
            const all = byType.get(type) ?? [];
            // Hundreds of hotspots on a bad fire day: list the biggest (and any
            // whose smoke reaches the citizen) and send the rest to the map.
            const items =
              type === 'wildfire'
                ? [...all]
                    .sort(
                      (a, b) =>
                        Number(b.smokeTowardUser) - Number(a.smokeTowardUser) ||
                        ((b.event.details as WildfireDetails | null)?.hotspotCount ?? 0) -
                          ((a.event.details as WildfireDetails | null)?.hotspotCount ?? 0),
                    )
                    .slice(0, WILDFIRE_LISTED)
                : all;
            const hiddenCount = (totals.get(type) ?? all.length) - items.length;
            if (items.length === 0) return null;
            return (
              <section key={type}>
                <SectionTitle
                  action={
                    type === 'wildfire' ? (
                      <Link href="/peta#asap" className="inline-flex items-center gap-1 text-sm font-extrabold text-primary">
                        <CloudFog className="h-4 w-4" /> Lihat sebaran asap
                      </Link>
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">{GROUP_SOURCE[type]}</span>
                    )
                  }
                >
                  {HAZARD_LABEL_ID[type]} ({(totals.get(type) ?? all.length).toLocaleString('id-ID')})
                </SectionTitle>
                {type === 'wildfire' && hotspotMap && (
                  <p className="mb-3 text-xs font-bold text-muted-foreground">
                    {hotspotMap.totals.detections.toLocaleString('id-ID')} deteksi satelit dalam{' '}
                    {totals.get('wildfire')?.toLocaleString('id-ID')} area (
                    {hotspotMap.totals.clustersInIndonesia.toLocaleString('id-ID')} di Indonesia)
                    {latestSatellite && ` · lintasan satelit terakhir ${timeAgo(latestSatellite)}`}. Satelit melintas beberapa
                    kali sehari, jadi data bisa tertinggal beberapa jam.
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {items.map((item) => (
                    <NationalEventCard key={item.event.id} item={item} />
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <Link href={type === 'wildfire' ? '/peta#asap' : '/peta'} className="mt-3 inline-block text-sm font-extrabold text-primary">
                    + {hiddenCount.toLocaleString('id-ID')} {type === 'wildfire' ? 'area titik api' : 'kejadian'} lainnya, lihat di
                    peta →
                  </Link>
                )}
              </section>
            );
          })}
        </div>
        <aside className="grid gap-5 lg:sticky lg:top-24">
          <Link href="/#keluarga" className={cn(card, 'citizen-lift flex items-center gap-3 p-4')}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent text-primary">
              <Users className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">Pantau wilayah keluarga</span>
              <span className="block text-sm text-muted-foreground">Tambah wilayah dan nomor keluarga di Beranda.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <p className="text-xs text-muted-foreground">
            Gunung api dan kualitas udara belum tersedia sebagai data otomatis. Peringatan erupsi dan asap berbahaya tetap
            dikirim petugas BPBD lewat peringatan darurat.
          </p>
        </aside>
      </div>
    </PageContainer>
  );
}

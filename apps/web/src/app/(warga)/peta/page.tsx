'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CloudFog, Loader2, Tent } from 'lucide-react';
import { card, WindCard } from '@/components/citizen/home-widgets';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import type { MapShelter } from '@/components/citizen/citizen-map';
import { PageContainer, PageHeading } from '@/components/citizen/page-container';
import { FireStory, SmokeAnswer, SmokeLegend, SmokeTimeSelector } from '@/components/citizen/smoke-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useDistricts } from '@/hooks/use-geo';
import { NATIONAL_ORDER, useNationalEvents } from '@/hooks/use-national-events';
import { useActiveAlerts, usePublicWeather } from '@/hooks/use-public-alerts';
import { useShelters } from '@/hooks/use-resource-plans';
import { useSmokePlumes } from '@/hooks/use-smoke-plumes';
import { CITIZEN_HAZARD_COLORS, CITIZEN_SHELTER_COLOR, CITIZEN_USER_COLOR } from '@/lib/chart-colors';
import { locationLatLng, locationSummary } from '@/lib/citizen/geo';
import { plumeReach } from '@/lib/citizen/smoke';
import { shelterLatLng, SHELTER_KIND_COLORS, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import { HAZARD_LABEL_ID } from '@/lib/citizen/status';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import type { HazardType } from '@/types/domain';

// react-leaflet touches `window` at import time — client-only, same as
// components/map/map-loader.tsx.
const CitizenMap = dynamic(() => import('@/components/citizen/citizen-map').then((mod) => mod.CitizenMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[inherit]" />,
});

export default function CitizenMapPage() {
  const location = useCitizenStore((state) => state.location);
  const weather = usePublicWeather(location?.districtId);
  const { events, isLoading } = useNationalEvents(location, weather.data);
  const shelters = useShelters(location?.districtId);
  const alerts = useActiveAlerts(location);
  const districts = useDistricts();
  const [hidden, setHidden] = useState<Set<HazardType>>(new Set());
  const [showSmoke, setShowSmoke] = useState(true);
  const [smokeHours, setSmokeHours] = useState(6);
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number; key: string } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const visibleEvents = useMemo(() => events.filter((item) => !hidden.has(item.event.hazardType)), [events, hidden]);
  const wildfireEvents = useMemo(
    () => (showSmoke && !hidden.has('wildfire') ? events.filter((item) => item.event.hazardType === 'wildfire').map((item) => item.event) : []),
    [events, hidden, showSmoke],
  );
  const userPoint = locationLatLng(location);
  const smoke = useSmokePlumes(wildfireEvents, smokeHours, userPoint);

  // Default selection: the fire whose smoke reaches the citizen, else the largest.
  const selectedPlume = useMemo(() => {
    if (smoke.plumes.length === 0) return null;
    const chosen = smoke.plumes.find((plume) => plume.fire.id === selectedFireId);
    if (chosen) return chosen;
    if (userPoint) {
      const reaching = smoke.plumes.find((plume) => plumeReach(plume, userPoint.lat, userPoint.lng));
      if (reaching) return reaching;
    }
    return smoke.plumes[0];
  }, [smoke.plumes, selectedFireId, userPoint]);

  const selectFire = (fireId: string) => {
    setSelectedFireId(fireId);
    const plume = smoke.plumes.find((p) => p.fire.id === fireId);
    if (plume) {
      const mid = plume.centerline[Math.floor(plume.centerline.length / 2)];
      setFocus({ lat: mid.lat, lng: mid.lng, zoom: 7, key: `${fireId}-${Date.now()}` });
      mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // /peta#asap (linked from "Indonesia hari ini") opens straight on the smoke.
  useEffect(() => {
    if (window.location.hash !== '#asap' || !selectedPlume || focus) return;
    const mid = selectedPlume.centerline[Math.floor(selectedPlume.centerline.length / 2)];
    setFocus({ lat: mid.lat, lng: mid.lng, zoom: 6, key: 'hash' });
  }, [selectedPlume, focus]);

  const mapShelters = useMemo<MapShelter[]>(
    () =>
      (location ? (shelters.data ?? []) : []).flatMap((shelter) => {
        const point = shelterLatLng(shelter);
        return point
          ? [{ id: shelter.id, name: shelter.name, kind: shelter.kind, capacity: shelter.capacity, ...point }]
          : [];
      }),
    [location, shelters.data],
  );

  const toggle = (type: HazardType) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const hasFires = smoke.clusters.length > 0;

  return (
    <PageContainer className="overflow-x-clip">
      <PageHeading
        title="Peta kejadian"
        description="Kejadian 24 jam terakhir, sebaran asap kebakaran lahan, posko, dan tujuan evakuasi. Ketuk titik atau ikon api untuk penjelasan."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="grid min-w-0 gap-3">
          {/* Phones: one swipeable row instead of ragged wrapped lines. */}
      <div
        className="-mx-3 flex gap-1.5 overflow-x-auto sm:gap-2 px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Tampilkan jenis kejadian"
      >
            {NATIONAL_ORDER.map((type) => {
              const on = !hidden.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(type)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-colors sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm sm:font-extrabold',
                    on ? 'border-border bg-card' : 'border-dashed border-border bg-transparent text-muted-foreground line-through',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full sm:h-3 sm:w-3" style={{ background: CITIZEN_HAZARD_COLORS[type] }} />
                  {HAZARD_LABEL_ID[type]}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={showSmoke}
              onClick={() => setShowSmoke((v) => !v)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-colors sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm sm:font-extrabold',
                showSmoke ? 'border-primary bg-accent text-primary' : 'border-dashed border-border text-muted-foreground',
              )}
            >
              <CloudFog className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Sebaran asap
            </button>
          </div>

          {showSmoke && hasFires && (
            <>
              {/* Phones/tablets: the answer comes before the map; laptops show it in the side panel. */}
              <div className="lg:hidden">
                <SmokeAnswer plumes={smoke.plumes} location={location} hours={smokeHours} onShowFire={selectFire} />
              </div>
              <SmokeTimeSelector hours={smokeHours} onChange={setSmokeHours} />
            </>
          )}

          <div
            ref={mapRef}
            className="relative h-[58svh] min-h-[360px] overflow-hidden rounded-3xl border border-border/70 lg:h-[calc(100svh-17rem)] lg:min-h-[520px]"
          >
            <CitizenMap
              events={visibleEvents}
              user={userPoint && location ? { ...userPoint, label: locationSummary(location) } : null}
              shelters={mapShelters}
              alerts={alerts.data ?? []}
              plumes={showSmoke ? smoke.plumes : []}
              selectedFireId={selectedPlume?.fire.id ?? null}
              onSelectFire={selectFire}
              focus={focus}
              showHotspotPoints={!hidden.has('wildfire')}
            />
            {showSmoke && hasFires && smoke.isLoading && (
              <span className="absolute top-3 left-3 z-[400] inline-flex items-center gap-2 rounded-full bg-card/95 px-3 py-1.5 text-xs font-bold shadow">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menghitung arah asap…
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ background: CITIZEN_USER_COLOR }} /> Wilayah Anda
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ background: CITIZEN_SHELTER_COLOR }} /> Posko
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ background: SHELTER_KIND_COLORS.assembly_point }} /> Titik kumpul
            </span>
            <span>{isLoading ? 'Memuat kejadian…' : `${visibleEvents.length} kejadian ditampilkan`}</span>
          </div>
          {showSmoke && smoke.plumes.length > 1 && (
            <section className={cn(card, 'grid gap-2')}>
              <h2 className="text-lg font-black">Titik api lainnya ({smoke.plumes.length})</h2>
              <div className="flex flex-wrap gap-2">
                {smoke.plumes.map((plume) => (
                  <button
                    key={plume.fire.id}
                    type="button"
                    onClick={() => selectFire(plume.fire.id)}
                    aria-pressed={plume.fire.id === selectedPlume?.fire.id}
                    className={cn(
                      'max-w-full truncate rounded-full border px-3 py-1.5 text-sm font-bold',
                      plume.fire.id === selectedPlume?.fire.id
                        ? 'border-primary bg-accent text-primary'
                        : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    {plume.fire.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside id="asap" className="grid min-w-0 scroll-mt-24 gap-5">
          {showSmoke && hasFires && (
            <>
              <div className="hidden lg:block">
                <SmokeAnswer plumes={smoke.plumes} location={location} hours={smokeHours} onShowFire={selectFire} />
              </div>
              {smoke.isError && (
                <p className={cn(card, 'text-sm text-muted-foreground')}>
                  Arah angin belum bisa dimuat, jadi sebaran asap belum bisa digambar. Coba lagi sebentar.
                </p>
              )}
              {selectedPlume && (
                <FireStory
                  plume={selectedPlume}
                  districts={districts.data ?? []}
                  userDistrictId={location?.districtId ?? null}
                />
              )}
              <SmokeLegend modelRun={smoke.modelRun} />
            </>
          )}
          {showSmoke && !hasFires && !isLoading && (
            <p className={cn(card, 'flex gap-2 text-sm text-muted-foreground')}>
              <CloudFog className="h-5 w-5 shrink-0" /> Tidak ada titik api terpantau dalam 24 jam terakhir, jadi tidak ada
              sebaran asap yang digambar.
            </p>
          )}

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-1">
            {location ? (
              <WindCard location={location} />
            ) : (
              <p className={cn(card, 'text-sm text-muted-foreground')}>
                Pilih wilayah di beranda untuk melihat arah angin dan posko di sekitar Anda.
              </p>
            )}
            <section className={cn(card, 'grid gap-3')}>
              <h2 className="flex items-center gap-2 text-lg font-black">
                <Tent className="h-5 w-5 text-lv-normal" /> Posko & titik kumpul di wilayah Anda
              </h2>
              {!location ? (
                <p className="text-sm text-muted-foreground">Belum ada wilayah yang dipilih.</p>
              ) : mapShelters.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada posko atau titik kumpul terdaftar untuk wilayah ini.</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {mapShelters.map((shelter) => (
                    <li key={shelter.id} className="flex justify-between gap-3">
                      <span className="font-bold">
                        {shelter.name}
                        <span className="ml-1.5 text-xs font-semibold text-muted-foreground">
                          {SHELTER_KIND_LABELS[shelter.kind]}
                        </span>
                      </span>
                      {shelter.capacity > 0 && (
                        <span className="text-muted-foreground">{shelter.capacity.toLocaleString('id-ID')} org</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className={cn(card, 'grid gap-2 text-sm')}>
            <h2 className="text-lg font-black">Warna titik kejadian</h2>
            {NATIONAL_ORDER.map((type) => (
              <p key={type} className="flex items-center gap-2">
                <HazardIcon hazardType={type} className="h-4 w-4" style={{ color: CITIZEN_HAZARD_COLORS[type] }} />
                {HAZARD_LABEL_ID[type]}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Titik lebih besar berarti dekat wilayah Anda. Lokasi wilayah Anda adalah titik pusat kabupaten/kota.
            </p>
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}

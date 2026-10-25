'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CloudFog, Loader2 } from 'lucide-react';
import type { MapShelter } from '@/components/citizen/citizen-map';
import { SmokeTimeSelector } from '@/components/citizen/smoke-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { NATIONAL_ORDER, type NationalEvent } from '@/hooks/use-national-events';
import { useActiveAlerts } from '@/hooks/use-public-alerts';
import { useShelters } from '@/hooks/use-resource-plans';
import { useSmokePlumes } from '@/hooks/use-smoke-plumes';
import { CITIZEN_HAZARD_COLORS, CITIZEN_SHELTER_COLOR, CITIZEN_USER_COLOR } from '@/lib/chart-colors';
import { locationLatLng, locationSummary } from '@/lib/citizen/geo';
import { shelterLatLng, SHELTER_KIND_COLORS } from '@/lib/citizen/shelters';
import { HAZARD_LABEL_ID } from '@/lib/citizen/status';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import type { HazardType } from '@/types/domain';

// react-leaflet touches `window` at import time — client-only, same as /peta.
const CitizenMap = dynamic(() => import('@/components/citizen/citizen-map').then((mod) => mod.CitizenMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[inherit]" />,
});

/** Home-page version of /peta: the same satellite map, hazard filters,
 * animated smoke plumes and legend, opened on the whole country. The smoke
 * answer and per-fire story stay on /peta. */
export function IndonesiaEventMap({ items, className }: { items: NationalEvent[]; className?: string }) {
  const location = useCitizenStore((state) => state.location);
  const shelters = useShelters(location?.districtId);
  const alerts = useActiveAlerts(location);
  const [hidden, setHidden] = useState<Set<HazardType>>(new Set());
  const [showSmoke, setShowSmoke] = useState(true);
  const [smokeHours, setSmokeHours] = useState(6);
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null);

  const visibleEvents = useMemo(() => items.filter((item) => !hidden.has(item.event.hazardType)), [items, hidden]);
  const wildfireEvents = useMemo(
    () => (showSmoke && !hidden.has('wildfire') ? items.filter((item) => item.event.hazardType === 'wildfire').map((item) => item.event) : []),
    [items, hidden, showSmoke],
  );
  const userPoint = locationLatLng(location);
  const smoke = useSmokePlumes(wildfireEvents, smokeHours, userPoint);
  const hasFires = smoke.clusters.length > 0;

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

  return (
    <div className={cn('grid min-w-0 gap-3', className)}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tampilkan jenis kejadian">
        {NATIONAL_ORDER.map((type) => {
          const on = !hidden.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(type)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-extrabold transition-colors',
                on ? 'border-border bg-card' : 'border-dashed border-border bg-transparent text-muted-foreground line-through',
              )}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: CITIZEN_HAZARD_COLORS[type] }} />
              {HAZARD_LABEL_ID[type]}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showSmoke}
          onClick={() => setShowSmoke((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-extrabold transition-colors',
            showSmoke ? 'border-primary bg-accent text-primary' : 'border-dashed border-border text-muted-foreground',
          )}
        >
          <CloudFog className="h-4 w-4" /> Sebaran asap
        </button>
      </div>

      {showSmoke && hasFires && <SmokeTimeSelector hours={smokeHours} onChange={setSmokeHours} />}

      <div className="relative h-[46svh] min-h-[300px] overflow-hidden rounded-3xl border border-border/70 lg:h-[440px]">
        <CitizenMap
          events={visibleEvents}
          user={userPoint && location ? { ...userPoint, label: locationSummary(location) } : null}
          shelters={mapShelters}
          alerts={alerts.data ?? []}
          plumes={showSmoke ? smoke.plumes : []}
          selectedFireId={selectedFireId ?? smoke.plumes[0]?.fire.id ?? null}
          onSelectFire={setSelectedFireId}
          showHotspotPoints={!hidden.has('wildfire')}
          nationalView
          scrollWheelZoom={false}
        />
        {showSmoke && hasFires && smoke.isLoading && (
          <span className="absolute top-3 left-3 z-[400] inline-flex items-center gap-2 rounded-full bg-card/95 px-3 py-1.5 text-xs font-bold shadow">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menghitung arah asap…
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: CITIZEN_USER_COLOR }} /> Wilayah Anda
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: CITIZEN_SHELTER_COLOR }} /> Posko
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: SHELTER_KIND_COLORS.assembly_point }} /> Titik kumpul
        </span>
        <span>{visibleEvents.length} kejadian ditampilkan</span>
        <Link href="/peta" className="ml-auto text-sm font-extrabold text-primary">
          Peta lengkap & sebaran asap →
        </Link>
      </div>
    </div>
  );
}

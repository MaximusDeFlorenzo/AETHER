'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CloudFog, Loader2, Maximize2, X } from 'lucide-react';
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

export interface MapSelection {
  event: NationalEvent['event'];
  /** Changes on every tap, so tapping the same card again re-flies. */
  key: string;
}

/** Home-page version of /peta: the same satellite map, filters, animated
 * smoke and legend. On the page it is a fixed view of the whole country;
 * tapping an event card (or the expand button) opens it full screen,
 * zoomed to that event, where it can be panned and zoomed. */
export function IndonesiaEventMap({
  items,
  selection = null,
  onClose,
  className,
}: {
  items: NationalEvent[];
  /** Event picked from a card below the map: opens the full-screen map on it. */
  selection?: MapSelection | null;
  /** Called when the full-screen map is closed (clear `selection`). */
  onClose?: () => void;
  className?: string;
}) {
  const location = useCitizenStore((state) => state.location);
  const shelters = useShelters(location?.districtId);
  const alerts = useActiveAlerts(location);
  const [hidden, setHidden] = useState<Set<HazardType>>(new Set());
  const [showSmoke, setShowSmoke] = useState(true);
  const [smokeHours, setSmokeHours] = useState(6);
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fullscreen = expanded || selection !== null;

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

  const focus = useMemo(
    () => (selection ? { lat: selection.event.latitude, lng: selection.event.longitude, zoom: 9, key: selection.key } : null),
    [selection],
  );

  const close = () => {
    setExpanded(false);
    onClose?.();
  };

  // Full screen: lock the page behind it and close on Esc.
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen, onClose]);

  const toggle = (type: HazardType) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const controls = (
    <>
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
    </>
  );
  const timeSelector = showSmoke && hasFires && <SmokeTimeSelector hours={smokeHours} onChange={setSmokeHours} />;

  const map = (interactive: boolean) => (
    <>
      <CitizenMap
        events={visibleEvents}
        user={userPoint && location ? { ...userPoint, label: locationSummary(location) } : null}
        shelters={mapShelters}
        alerts={alerts.data ?? []}
        plumes={showSmoke ? smoke.plumes : []}
        selectedFireId={selectedFireId ?? smoke.plumes[0]?.fire.id ?? null}
        onSelectFire={setSelectedFireId}
        showHotspotPoints={interactive && !hidden.has('wildfire')}
        nationalView
        interactive={interactive}
        scrollWheelZoom={interactive}
        focus={interactive ? focus : null}
        selectedEventId={interactive ? (selection?.event.id ?? null) : null}
      />
      {showSmoke && hasFires && smoke.isLoading && (
        <span className="absolute top-3 left-3 z-[400] inline-flex items-center gap-2 rounded-full bg-card/95 px-3 py-1.5 text-xs font-bold shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menghitung arah asap…
        </span>
      )}
    </>
  );

  const legend = (
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
  );

  return (
    <div className={cn('grid min-w-0 gap-3', className)}>
      {controls}

      <div className="relative aspect-[2.2/1] overflow-hidden rounded-2xl border border-border/70 sm:aspect-auto sm:h-80 sm:rounded-3xl lg:h-[400px]">
        {!fullscreen && map(false)}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute right-2 bottom-2 z-[400] inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-xs font-extrabold shadow sm:right-3 sm:bottom-3 sm:px-3 sm:py-1.5"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Perbesar peta
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ketuk kartu kejadian di bawah untuk melihat lokasinya dari dekat{showSmoke && hasFires ? ' dan mengatur perkiraan asap' : ''}.
      </p>

      {fullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Peta kejadian Indonesia hari ini"
          className="fixed inset-0 z-[60] flex flex-col gap-3 bg-background p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] font-citizen sm:p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-lg font-black">Indonesia hari ini</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Tutup peta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card shadow-sm hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {controls}
          {timeSelector}
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-border/70">{map(true)}</div>
          {legend}
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import { useTheme } from '@/components/providers/theme-provider';
import { hazardTypeToColor, riskLevelToColor } from '@/lib/chart-colors';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type {
  EarthquakeDetails,
  FloodDetails,
  HazardEvent,
  HazardType,
  LandslideDetails,
  SpatialOverlayFeatureCollection,
  WildfireDetails,
} from '@/types/domain';

// Thresholds mirrored from apps/ai-engine (flood.py/wildfire.py's
// MAX_RELEVANT_*, explainability.py's HIGH_WATER_LEVEL_M/HIGH_FRP_CONFIDENCE)
// so the map's visual severity cues match what the risk engine itself
// treats as significant.
const MAX_RELEVANT_WATER_LEVEL_M = 5.0;
const MAX_RELEVANT_HOTSPOT_COUNT = 20;
const HIGH_WATER_LEVEL_M = 3.0;
const HIGH_FRP_CONFIDENCE = 0.75;

const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

const INDONESIA_CENTER: [number, number] = [-2.5, 118];

/** Point radius + "warrants a second look" heuristic, generalized from
 * ORION's magnitude-only radius/pulse rule to each hazard's own detail
 * shape. */
function hazardEventRadius(event: HazardEvent): number {
  switch (event.hazardType) {
    case 'earthquake': {
      const magnitude = (event.details as EarthquakeDetails).magnitude ?? 4;
      return 4 + Math.max(0, magnitude - 3) * 3;
    }
    case 'landslide': {
      const saturation = (event.details as LandslideDetails).soilSaturationPct ?? 40;
      return 4 + saturation / 12;
    }
    case 'flood': {
      const waterLevelM = (event.details as FloodDetails).waterLevelM ?? 0;
      return 4 + Math.min(waterLevelM, MAX_RELEVANT_WATER_LEVEL_M) * 1.6;
    }
    case 'wildfire': {
      const hotspotCount = (event.details as WildfireDetails).hotspotCount ?? 0;
      return 4 + (Math.min(hotspotCount, MAX_RELEVANT_HOTSPOT_COUNT) / MAX_RELEVANT_HOTSPOT_COUNT) * 8;
    }
    default:
      return 6;
  }
}

function isHighSeverity(event: HazardEvent): boolean {
  if (event.hazardType === 'earthquake') {
    return ((event.details as EarthquakeDetails).magnitude ?? 0) >= 6;
  }
  if (event.hazardType === 'landslide') {
    return ((event.details as LandslideDetails).soilSaturationPct ?? 0) >= 80;
  }
  if (event.hazardType === 'flood') {
    return ((event.details as FloodDetails).waterLevelM ?? 0) >= HIGH_WATER_LEVEL_M;
  }
  if (event.hazardType === 'wildfire') {
    return ((event.details as WildfireDetails).frpConfidence ?? 0) >= HIGH_FRP_CONFIDENCE;
  }
  return false;
}

function eventPopupDetail(event: HazardEvent): string | null {
  if (event.hazardType === 'earthquake') {
    const d = event.details as EarthquakeDetails;
    return `M${d.magnitude?.toFixed(1) ?? '—'} · ${d.depthKm ?? '—'} km depth`;
  }
  if (event.hazardType === 'landslide') {
    const d = event.details as LandslideDetails;
    return d.soilSaturationPct != null ? `${d.soilSaturationPct}% soil saturation` : null;
  }
  if (event.hazardType === 'flood') {
    const d = event.details as FloodDetails;
    if (d.waterLevelM == null && d.rainfallMm == null) return null;
    return `${d.waterLevelM ?? '—'}m water level · ${d.rainfallMm ?? '—'}mm rainfall`;
  }
  if (event.hazardType === 'wildfire') {
    const d = event.details as WildfireDetails;
    if (d.hotspotCount == null && d.frpConfidence == null) return null;
    const confidencePct = d.frpConfidence != null ? `${Math.round(d.frpConfidence * 100)}%` : '—';
    return `${d.hotspotCount ?? '—'} hotspot(s) · ${confidencePct} confidence`;
  }
  return null;
}

interface HazardMapProps {
  events: HazardEvent[];
  /** GeoJSON polygon overlay (risk/vulnerability/exposure zones) — new in
   * AETHER, ORION never served polygon data. */
  overlay?: SpatialOverlayFeatureCollection | null;
  overlayLabel?: string;
  onSelect?: (id: string) => void;
  height?: string;
  /** Focus zoom used when centering on a single hazard event. */
  focusZoom?: number;
  /** Hazard-type filter chips — ORION's single-hazard map never needed one;
   * AETHER's multi-hazard map defaults it on whenever more than one hazard
   * type is present in `events`. */
  showTypeFilter?: boolean;
  showOverlayToggle?: boolean;
}

export function HazardMap({
  events,
  overlay,
  overlayLabel = 'Risk overlay',
  onSelect,
  height = '100%',
  focusZoom = 9,
  showTypeFilter = true,
  showOverlayToggle = true,
}: HazardMapProps) {
  const { resolvedTheme } = useTheme();

  const presentTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.hazardType))) as HazardType[],
    [events],
  );
  const [enabledTypes, setEnabledTypes] = useState<Set<HazardType>>(() => new Set(presentTypes));
  const [overlayVisible, setOverlayVisible] = useState(true);

  const toggleType = (type: HazardType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filteredEvents = events.filter(
    (e) => enabledTypes.has(e.hazardType) || !presentTypes.includes(e.hazardType),
  );

  // Single-event views (e.g. the detail page) should focus that event's
  // location instead of showing the whole-country default. `key` forces
  // react-leaflet to remount with the new view — `center`/`zoom` props are
  // only read on mount.
  const isSingleFocus = events.length === 1;
  const center: [number, number] = isSingleFocus
    ? [events[0].latitude, events[0].longitude]
    : INDONESIA_CENTER;
  const zoom = isSingleFocus ? focusZoom : 5;

  return (
    <div className="relative h-full w-full">
      {(showTypeFilter && presentTypes.length > 1) || (showOverlayToggle && overlay) ? (
        <div className="absolute top-2 left-2 z-[1000] flex flex-wrap gap-1.5">
          {showTypeFilter &&
            presentTypes.length > 1 &&
            presentTypes.map((type) => {
              const active = enabledTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-sm transition-colors',
                    active
                      ? 'border-transparent text-white'
                      : 'border-border bg-card/90 text-muted-foreground hover:text-foreground',
                  )}
                  style={active ? { background: hazardTypeToColor(type) } : undefined}
                >
                  {HAZARD_TYPE_LABELS[type]}
                </button>
              );
            })}
          {showOverlayToggle && overlay && (
            <button
              type="button"
              onClick={() => setOverlayVisible((v) => !v)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-sm transition-colors',
                overlayVisible
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card/90 text-muted-foreground hover:text-foreground',
              )}
            >
              {overlayLabel}
            </button>
          )}
        </div>
      ) : null}

      <MapContainer
        key={isSingleFocus ? events[0].id : 'overview'}
        center={center}
        zoom={zoom}
        scrollWheelZoom
        style={{ height, width: '100%' }}
        className="z-0 rounded-lg"
      >
        <TileLayer
          key={resolvedTheme}
          url={resolvedTheme === 'dark' ? TILE_URLS.dark : TILE_URLS.light}
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
        />

        {overlay && overlayVisible && (
          <GeoJSON
            key={`overlay-${overlay.features.length}`}
            data={overlay as unknown as GeoJSON.FeatureCollection}
            style={(feature) => ({
              color: riskLevelToColor(feature?.properties?.exposureLevel),
              fillColor: riskLevelToColor(feature?.properties?.exposureLevel),
              fillOpacity: 0.25,
              weight: 1,
            })}
          />
        )}

        {filteredEvents.map((event) => (
          <CircleMarker
            key={event.id}
            center={[event.latitude, event.longitude]}
            radius={hazardEventRadius(event)}
            pathOptions={{
              color: hazardTypeToColor(event.hazardType),
              fillColor: hazardTypeToColor(event.hazardType),
              fillOpacity: 0.55,
              weight: 1.5,
              className: isHighSeverity(event) ? 'hazard-marker-pulse' : undefined,
            }}
            eventHandlers={onSelect ? { click: () => onSelect(event.id) } : undefined}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{HAZARD_TYPE_LABELS[event.hazardType]}</p>
                <p>{event.locationLabel}</p>
                {eventPopupDetail(event) && (
                  <p className="text-xs text-muted-foreground">{eventPopupDetail(event)}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

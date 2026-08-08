'use client';

import { useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { hazardTypeToColor, riskLevelToColor } from '@/lib/chart-colors';
import { isHighSeverityHazardEvent } from '@/lib/hazard-severity';
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
// MAX_RELEVANT_*) — governs marker radius only; "high severity" (pulse cue)
// lives in lib/hazard-severity.ts, shared with the realtime alert sound.
const MAX_RELEVANT_WATER_LEVEL_M = 5.0;
const MAX_RELEVANT_HOTSPOT_COUNT = 20;

// Satellite imagery (Esri's free, no-API-key tile service) — swapped in from
// the flat Carto light/dark basemap so terrain/land-cover (forest canopy vs.
// built-up settlement) reads clearly at a glance, matching the "ArcGIS
// Dashboard" reference point in the design brief. Tile scheme is {z}/{y}/{x}
// (ArcGIS's convention, not the usual {z}/{x}/{y}).
//
// Deliberately NOT paired with Esri's "Reference/World_Boundaries_and_Places"
// label overlay: stacked as a second TileLayer, its place-name labels
// double-rendered at overlapping zoom levels (blurry ghost text under crisp
// text) instead of cleanly replacing on zoom — a real rendering bug, not a
// loading artifact. Event popups already carry the location name, so the
// map itself stays label-free and clean.
const SATELLITE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

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
  const presentTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.hazardType))) as HazardType[],
    [events],
  );
  const [enabledTypes, setEnabledTypes] = useState<Set<HazardType>>(() => new Set(presentTypes));
  const [overlayVisible, setOverlayVisible] = useState(true);
  // Satellite JPEG tiles are much heavier than a vector basemap and can take
  // several seconds on a slower connection — without this, the map reads as
  // broken/stuck rather than "still loading" during that window.
  const [tilesLoading, setTilesLoading] = useState(true);

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
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors',
                    active
                      ? 'border-transparent text-white'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
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
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors',
                overlayVisible
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {overlayLabel}
            </button>
          )}
        </div>
      ) : null}

      {tilesLoading && (
        <div className="absolute top-2 right-2 z-[1000] flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading imagery…
        </div>
      )}

      <MapContainer
        key={isSingleFocus ? events[0].id : 'overview'}
        center={center}
        zoom={zoom}
        scrollWheelZoom
        zoomControl={false}
        style={{ height, width: '100%' }}
        className="z-0 rounded-lg"
      >
        {/* Default top-left zoom control collides with the hazard-type/
            overlay filter chips (also top-left) once there's more than one
            hazard type present — moved out of the way rather than fighting
            over the same corner. */}
        <ZoomControl position="bottomright" />
        <TileLayer
          url={SATELLITE_TILE_URL}
          attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          eventHandlers={{
            loading: () => setTilesLoading(true),
            load: () => setTilesLoading(false),
          }}
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
              className: isHighSeverityHazardEvent(event) ? 'hazard-marker-pulse' : undefined,
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

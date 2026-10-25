'use client';

import { useMemo, useState } from 'react';
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, ZoomControl } from 'react-leaflet';
import { HAZARD_GLYPH_SVG, hazardPinIcon } from './hazard-pin';
import { MapViewSync } from './map-view-sync';
import leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@/lib/leaflet-attribution';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { hazardTypeToColor, riskLevelToColor } from '@/lib/chart-colors';
import { formatHazardEventLocation, isHighSeverityHazardEvent } from '@/lib/hazard-severity';
import { EXPOSURE_LEVEL_LABELS, HAZARD_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type {
  EarthquakeDetails,
  ExposureLevel,
  FloodDetails,
  HazardEvent,
  HazardType,
  LandslideDetails,
  SpatialOverlayFeatureCollection,
  WildfireDetails,
} from '@/types/domain';

const EXPOSURE_LEGEND_ORDER: ExposureLevel[] = ['low', 'moderate', 'high', 'severe'];

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
      const magnitude = (event.details as EarthquakeDetails | null)?.magnitude ?? 4;
      return 4 + Math.max(0, magnitude - 3) * 3;
    }
    case 'landslide': {
      const saturation = ((event.details as LandslideDetails | null)?.soilSaturation ?? 0.4) * 100;
      return 4 + saturation / 12;
    }
    case 'flood': {
      const waterLevelM = (event.details as FloodDetails | null)?.waterLevelM ?? 0;
      return 4 + Math.min(waterLevelM, MAX_RELEVANT_WATER_LEVEL_M) * 1.6;
    }
    case 'wildfire': {
      const hotspotCount = (event.details as WildfireDetails | null)?.hotspotCount ?? 0;
      return 4 + (Math.min(hotspotCount, MAX_RELEVANT_HOTSPOT_COUNT) / MAX_RELEVANT_HOTSPOT_COUNT) * 8;
    }
    default:
      return 6;
  }
}

/** Pin diameter in px: the old circle radius (the magnitude cue) doubled,
 * plus room for the glyph, kept between 24 and 40. */
function hazardPinSize(event: HazardEvent): number {
  return Math.min(40, Math.max(24, Math.round(hazardEventRadius(event) * 2 + 10)));
}

function HazardGlyph({ type, className }: { type: HazardType; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: HAZARD_GLYPH_SVG[type] }}
    />
  );
}

/** District rows in the `/spatial/overlay` response are frequently seeded
 * with only a Point centroid rather than an admin-boundary Polygon — Leaflet
 * renders GeoJSON Points as its default marker icon unless told otherwise,
 * and that icon's image assets aren't wired up under Next.js's bundler, so
 * it shows as a broken-image glyph. `pointToLayer` below swaps that for a
 * colored circle matching the polygon fill, so a district still reads as a
 * zone indicator regardless of which geometry shape it was seeded with. */
function overlayPointToLayer(feature: GeoJSON.Feature, latlng: leaflet.LatLng): leaflet.Layer {
  const color = riskLevelToColor(feature.properties?.exposureLevel);
  return leaflet.circleMarker(latlng, {
    radius: 9,
    color,
    fillColor: color,
    fillOpacity: 0.45,
    weight: 1.5,
  });
}

function overlayFeatureTooltip(properties: Record<string, unknown> | null | undefined): string {
  if (!properties) return '';
  const parts: string[] = [];
  if (typeof properties.districtName === 'string') parts.push(properties.districtName);
  const exposureLevel = properties.exposureLevel;
  if (typeof exposureLevel === 'string' && exposureLevel in EXPOSURE_LEVEL_LABELS) {
    parts.push(EXPOSURE_LEVEL_LABELS[exposureLevel as ExposureLevel]);
  }
  if (typeof properties.riskScore === 'number') {
    parts.push(`Risk ${Math.round(properties.riskScore)}`);
  }
  return parts.join(' · ');
}

function bindOverlayTooltip(feature: GeoJSON.Feature, layer: leaflet.Layer): void {
  const label = overlayFeatureTooltip(feature.properties);
  if (label) layer.bindTooltip(label, { sticky: true });
}

function eventPopupDetail(event: HazardEvent): string | null {
  if (event.hazardType === 'earthquake') {
    const d = event.details as EarthquakeDetails | null;
    return `M${d?.magnitude?.toFixed(1) ?? '—'} · ${d?.depthKm ?? '—'} km depth`;
  }
  if (event.hazardType === 'landslide') {
    const d = event.details as LandslideDetails | null;
    return d?.soilSaturation != null ? `${Math.round(d.soilSaturation * 100)}% soil saturation` : null;
  }
  if (event.hazardType === 'flood') {
    const d = event.details as FloodDetails | null;
    if (d?.waterLevelM == null && d?.rainfallMm == null) return null;
    return `${d?.waterLevelM ?? '—'}m water level · ${d?.rainfallMm ?? '—'}mm rainfall`;
  }
  if (event.hazardType === 'wildfire') {
    const d = event.details as WildfireDetails | null;
    if (d?.hotspotCount == null && d?.frpConfidence == null) return null;
    const confidencePct = d?.frpConfidence != null ? `${Math.round(d.frpConfidence * 100)}%` : '—';
    return `${d?.hotspotCount ?? '—'} hotspot(s) · ${confidencePct} confidence`;
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
        <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5">
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
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors',
                    active
                      ? 'border-transparent text-white'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                  style={active ? { background: hazardTypeToColor(type) } : undefined}
                >
                  <HazardGlyph type={type} className="h-3 w-3" />
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
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading imagery…
        </div>
      )}

      {(presentTypes.length > 0 || (overlay && overlayVisible)) && (
        <div className="absolute bottom-3 left-3 z-20 space-y-2 rounded-lg border border-border bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur-sm">
          {presentTypes.length > 0 && (
            <div>
              <p className="px-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Hazards</p>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                {presentTypes.map((type) => (
                  <span key={type} className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                    <span
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-white"
                      style={{ background: hazardTypeToColor(type) }}
                    >
                      <HazardGlyph type={type} className="h-2.5 w-2.5" />
                    </span>
                    {HAZARD_TYPE_LABELS[type]}
                  </span>
                ))}
              </div>
            </div>
          )}
          {overlay && overlayVisible && (
            <div>
              <p className="px-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {overlayLabel}
              </p>
              <div className="mt-1 flex items-center gap-2.5">
                {EXPOSURE_LEGEND_ORDER.map((level) => (
                  <span key={level} className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: riskLevelToColor(level) }}
                    />
                    {EXPOSURE_LEVEL_LABELS[level]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <MapContainer
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
        <MapViewSync center={center} zoom={zoom} />
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
            pointToLayer={overlayPointToLayer}
            onEachFeature={bindOverlayTooltip}
          />
        )}

        {filteredEvents.map((event) => (
          <Marker
            key={event.id}
            position={[event.latitude, event.longitude]}
            icon={hazardPinIcon(event.hazardType, hazardPinSize(event), isHighSeverityHazardEvent(event))}
            title={`${HAZARD_TYPE_LABELS[event.hazardType]} — ${formatHazardEventLocation(event)}`}
            eventHandlers={onSelect ? { click: () => onSelect(event.id) } : undefined}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{HAZARD_TYPE_LABELS[event.hazardType]}</p>
                <p>{formatHazardEventLocation(event)}</p>
                {eventPopupDetail(event) && (
                  <p className="text-xs text-muted-foreground">{eventPopupDetail(event)}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

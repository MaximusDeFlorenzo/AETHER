'use client';

import { Fragment, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { CircleMarker, GeoJSON, MapContainer, Polyline, TileLayer, Tooltip, ZoomControl } from 'react-leaflet';
import { MapViewSync } from '@/components/map/map-view-sync';
import 'leaflet/dist/leaflet.css';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { GeoPolygon, KarhutlaForecast, SurfaceWeatherHour } from '@/types/karhutla';
import { KARHUTLA_STYLES, SMOKE_OPACITY, exposedPlacesAt } from './karhutla-utils';
import { cartoTileUrl } from '@/lib/map-tiles';

// Same keyless Esri imagery as components/map/hazard-map.tsx; the street
// basemap is the Carto style the citizen map uses. Grey smoke reads better on
// the street basemap than on dark imagery.
const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  streets: {
    label: 'Streets',
    url: cartoTileUrl('voyager'),
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
} as const;
type BasemapKey = keyof typeof BASEMAPS;
const DATA_ATTRIBUTION = 'Hotspots: NASA FIRMS | Weather: Open-Meteo (CC BY 4.0) | Places: &copy; OpenStreetMap contributors';
const INDONESIA_CENTER: [number, number] = [-2.5, 113];

export { KARHUTLA_STYLES };

export type LayerKey = 'hotspots' | 'footprint' | 'spread' | 'smoke' | 'wind' | 'places';
export const LAYER_LABELS: Record<LayerKey, string> = {
  hotspots: 'Hotspots',
  footprint: 'Footprint',
  spread: 'Spread',
  smoke: 'Smoke',
  wind: 'Wind',
  places: 'Places',
};
const LAYER_SWATCH: Record<LayerKey, string> = {
  hotspots: KARHUTLA_STYLES.hotspot,
  footprint: KARHUTLA_STYLES.footprint,
  spread: KARHUTLA_STYLES.spread,
  smoke: '#a1a1aa',
  wind: KARHUTLA_STYLES.wind,
  places: '#ffffff',
};

const asGeoJson = (g: GeoPolygon) => g as unknown as GeoJSON.GeoJsonObject;

/** Endpoint of a wind arrow: drift distance in 1 h toward downwind. */
function windArrow(lat: number, lon: number, w: SurfaceWeatherHour): [number, number][][] {
  const toward = ((w.windFromDeg + 180) % 360) * (Math.PI / 180);
  const km = Math.max(3, Math.min(w.windSpeedKmh, 40)) * 1.5;
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const end: [number, number] = [lat + (km * Math.cos(toward)) / 110.57, lon + (km * Math.sin(toward)) / kmPerDegLon];
  const head = (offset: number): [number, number] => {
    const a = toward + Math.PI + offset;
    const h = km * 0.25;
    return [end[0] + (h * Math.cos(a)) / 110.57, end[1] + (h * Math.sin(a)) / kmPerDegLon];
  };
  return [
    [[lat, lon], end],
    [head(0.45), end, head(-0.45)],
  ];
}

function nearestHour(hours: SurfaceWeatherHour[], at: string): SurfaceWeatherHour | null {
  const t = new Date(at).getTime();
  let best: SurfaceWeatherHour | null = null;
  for (const h of hours) {
    if (!best || Math.abs(new Date(h.time).getTime() - t) < Math.abs(new Date(best.time).getTime() - t)) best = h;
  }
  return best;
}

interface KarhutlaMapProps {
  forecasts: KarhutlaForecast[];
  horizonHours: number;
  issuedAt: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function KarhutlaMap({ forecasts, horizonHours, issuedAt, selectedId, onSelect }: KarhutlaMapProps) {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    hotspots: true,
    footprint: true,
    spread: true,
    smoke: true,
    wind: true,
    places: true,
  });
  const [basemap, setBasemap] = useState<BasemapKey>('satellite');
  const selected = forecasts.find((f) => f.id === selectedId) ?? null;
  const center: [number, number] = selected ? [selected.location.latitude, selected.location.longitude] : INDONESIA_CENTER;
  const validAt = issuedAt ? new Date(new Date(issuedAt).getTime() + horizonHours * 3_600_000).toISOString() : null;

  const exposedPlaces = useMemo(() => exposedPlacesAt(forecasts, horizonHours), [forecasts, horizonHours]);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
        <div role="group" aria-label="Map layers" className="pointer-events-auto flex flex-wrap gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm">
          <Layers className="mx-1 h-3.5 w-3.5 self-center text-muted-foreground" aria-hidden />
          {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={layers[key]}
              onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                layers[key] ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className="h-2 w-2 rounded-full border border-black/20"
                style={{ background: layers[key] ? LAYER_SWATCH[key] : 'transparent' }}
              />
              {LAYER_LABELS[key]}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Basemap" className="pointer-events-auto flex rounded-lg border border-border bg-card/95 p-1 shadow-sm">
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={basemap === key}
              onClick={() => setBasemap(key)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                basemap === key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {BASEMAPS[key].label}
            </button>
          ))}
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={selected ? 8 : 5}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
        className="z-0 rounded-lg"
      >
        <MapViewSync center={center} zoom={selected ? 8 : 5} />
        <ZoomControl position="bottomright" />
        <TileLayer
          key={basemap}
          url={BASEMAPS[basemap].url}
          attribution={`${BASEMAPS[basemap].attribution} | ${DATA_ATTRIBUTION}`}
        />

        {forecasts.map((f) => {
          const smoke = f.predicted.smoke?.horizons.find((h) => h.horizonHours === horizonHours);
          const spread = f.predicted.spread?.horizons.find((h) => h.horizonHours === horizonHours);
          const wind = validAt && f.weather ? nearestHour(f.weather.surfaceHours, validAt) : null;
          const dim = selectedId !== null && selectedId !== f.id;
          return (
            <Fragment key={f.id}>
              {layers.smoke &&
                smoke?.status === 'ok' &&
                [...smoke.footprint].reverse().map(
                  (cls) =>
                    cls.geometry && (
                      <GeoJSON
                        key={`${f.id}-smoke-${cls.level}-${horizonHours}`}
                        data={asGeoJson(cls.geometry)}
                        style={{
                          color: KARHUTLA_STYLES.smokeStroke,
                          weight: 0,
                          fillColor: KARHUTLA_STYLES.smoke,
                          fillOpacity: SMOKE_OPACITY[cls.level] * (dim ? 0.4 : 1),
                        }}
                      >
                        <Tooltip sticky>
                          Smoke transport ({cls.level}, model): {Math.round(cls.particleShare * 100)}% of simulated
                          particles — relative density, not concentration
                        </Tooltip>
                      </GeoJSON>
                    ),
                )}

              {layers.spread && spread?.status === 'ok' && spread.envelope && (
                <GeoJSON
                  key={`${f.id}-spread-${horizonHours}`}
                  data={asGeoJson(spread.envelope)}
                  style={{
                    color: KARHUTLA_STYLES.spread,
                    weight: 2,
                    dashArray: '6 5',
                    fillColor: KARHUTLA_STYLES.spread,
                    fillOpacity: dim ? 0.05 : 0.14,
                  }}
                  eventHandlers={{ click: () => onSelect(f.id) }}
                >
                  <Tooltip sticky>
                    Potential spread envelope (model, upper-bound scenario) · +{horizonHours} h ·{' '}
                    {spread.areaKm2?.toLocaleString()} km²
                  </Tooltip>
                </GeoJSON>
              )}

              {layers.footprint && f.observed.pixelFootprint && (
                <GeoJSON
                  key={`${f.id}-footprint`}
                  data={asGeoJson(f.observed.pixelFootprint)}
                  style={{ color: KARHUTLA_STYLES.footprint, weight: 1.5, fillOpacity: 0 }}
                >
                  <Tooltip sticky>Observed hotspot pixel footprint (not a fire perimeter)</Tooltip>
                </GeoJSON>
              )}

              {layers.hotspots &&
                f.observed.hotspots.map((h) => (
                  <CircleMarker
                    key={h.id}
                    center={[h.latitude, h.longitude]}
                    radius={3}
                    pathOptions={{
                      color: '#7c2d12',
                      weight: 1,
                      fillColor: KARHUTLA_STYLES.hotspot,
                      fillOpacity: dim ? 0.5 : 0.95,
                    }}
                    eventHandlers={{ click: () => onSelect(f.id) }}
                  >
                    <Tooltip>
                      Satellite hotspot (observed) · {format(new Date(h.observedAt), 'dd MMM HH:mm')} UTC
                      {h.frpMw != null ? ` · FRP ${h.frpMw} MW` : ''}
                      {h.confidence != null ? ` · conf. ${Math.round(h.confidence * 100)}%` : ''}
                    </Tooltip>
                  </CircleMarker>
                ))}

              {layers.wind && wind && (
                <Polyline
                  positions={windArrow(f.location.latitude, f.location.longitude, wind)}
                  pathOptions={{ color: KARHUTLA_STYLES.wind, weight: 3, opacity: dim ? 0.4 : 0.95 }}
                >
                  <Tooltip sticky>
                    Wind 10 m (NWP forecast) at {format(new Date(wind.time), 'dd MMM HH:mm')}:{' '}
                    {wind.windSpeedKmh.toFixed(0)} km/h from {Math.round(wind.windFromDeg)}°
                  </Tooltip>
                </Polyline>
              )}
            </Fragment>
          );
        })}

        {layers.places &&
          exposedPlaces.map(({ place, reason }) => (
            <CircleMarker
              key={`${place.source}:${place.id}`}
              center={[place.latitude, place.longitude]}
              radius={place.kind === 'district_reference_point' ? 6 : 4}
              pathOptions={{
                color: reason === 'spread' ? KARHUTLA_STYLES.spread : KARHUTLA_STYLES.smokeStroke,
                weight: 2,
                fillColor: '#ffffff',
                fillOpacity: 0.9,
              }}
            >
              <Tooltip>
                {place.name} ({place.kind === 'district_reference_point' ? 'district reference location' : place.placeType ?? 'settlement'})
                {' · '}
                {reason === 'spread' ? 'inside spread envelope' : `inside ${reason} smoke class`}
              </Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>

    </div>
  );
}

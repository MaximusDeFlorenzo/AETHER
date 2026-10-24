'use client';

import { format } from 'date-fns';
import { CircleMarker, MapContainer, TileLayer, Tooltip, ZoomControl } from 'react-leaflet';
import { MapViewSync } from '@/components/map/map-view-sync';
import 'leaflet/dist/leaflet.css';
import { SATELLITE_TILES } from '@/lib/map-tiles';
import { type EarthquakeEvent, formatMagnitude, magnitudeColor } from './earthquake-utils';

const BASEMAP = SATELLITE_TILES;
const DATA_ATTRIBUTION = 'Earthquakes: BMKG';
const INDONESIA_CENTER: [number, number] = [-2.5, 118];

interface EarthquakeMapProps {
  events: EarthquakeEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Epicentres sized and coloured by magnitude; tsunami-potential events get
 * a red ring. */
export function EarthquakeMap({ events, selectedId, onSelect }: EarthquakeMapProps) {
  const selected = events.find((e) => e.id === selectedId) ?? null;
  const center: [number, number] = selected ? [selected.latitude, selected.longitude] : INDONESIA_CENTER;
  const zoom = selected ? 7 : 5;
  // Draw small quakes first so strong ones sit on top.
  const ordered = [...events].sort((a, b) => a.details.magnitude - b.details.magnitude);

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
      className="z-0 rounded-lg"
    >
      <MapViewSync center={center} zoom={zoom} />
      <ZoomControl position="bottomright" />
      <TileLayer url={BASEMAP.url} attribution={`${BASEMAP.attribution} | ${DATA_ATTRIBUTION}`} />
      {ordered.map((e) => {
        const { magnitude, depthKm, potentialTsunami } = e.details;
        const isSelected = e.id === selectedId;
        return (
          <CircleMarker
            key={e.id}
            center={[e.latitude, e.longitude]}
            radius={Math.max(4, (magnitude - 2) * 3) + (isSelected ? 3 : 0)}
            pathOptions={{
              color: isSelected ? '#0f172a' : potentialTsunami ? '#dc2626' : '#ffffff',
              weight: isSelected || potentialTsunami ? 2.5 : 1,
              fillColor: magnitudeColor(magnitude),
              fillOpacity: 0.85,
            }}
            eventHandlers={{ click: () => onSelect(e.id) }}
          >
            <Tooltip>
              <strong>{formatMagnitude(magnitude)}</strong> · {depthKm} km deep
              <br />
              {e.locationLabel ?? e.region ?? `${e.latitude.toFixed(2)}, ${e.longitude.toFixed(2)}`}
              <br />
              {format(new Date(e.eventTime), 'dd MMM yyyy HH:mm')}
              {potentialTsunami && ' · tsunami potential'}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

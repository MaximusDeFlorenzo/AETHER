'use client';

import { CircleMarker, MapContainer, TileLayer, Tooltip, ZoomControl } from 'react-leaflet';
import { MapViewSync } from '@/components/map/map-view-sync';
import 'leaflet/dist/leaflet.css';
import '@/lib/leaflet-attribution';
import type { DistrictOutlook } from '@/types/rainfall';
import { SEVERITY_LABEL, SEVERITY_RANK, severityColor } from './rainfall-utils';
import { SATELLITE_TILES } from '@/lib/map-tiles';

// Satellite basemap, as the citizen and analyst maps.
const BASEMAP = SATELLITE_TILES;
const DATA_ATTRIBUTION =
  'Rain: GSMaP by JAXA | Weather: Open-Meteo (CC BY 4.0) | Elevation: Copernicus GLO-90 | Hazard index: BNPB InaRISK';
const INDONESIA_CENTER: [number, number] = [-2.5, 118];

interface RainfallOutlookMapProps {
  districts: DistrictOutlook[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** District reference points coloured by the higher of the flood and
 * landslide levels. Points, not areas: no district boundaries exist. */
export function RainfallOutlookMap({ districts, selectedId, onSelect }: RainfallOutlookMapProps) {
  const selected = districts.find((d) => d.districtId === selectedId) ?? null;
  const center: [number, number] = selected ? [selected.latitude, selected.longitude] : INDONESIA_CENTER;
  const zoom = selected ? 8 : 5;
  // Draw low levels first so raised districts sit on top.
  const ordered = [...districts].sort(
    (a, b) => (a.severity ? SEVERITY_RANK[a.severity] : -1) - (b.severity ? SEVERITY_RANK[b.severity] : -1),
  );

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
      {ordered.map((d) => {
        const rank = d.severity ? SEVERITY_RANK[d.severity] : -1;
        const isSelected = d.districtId === selectedId;
        return (
          <CircleMarker
            key={d.districtId}
            center={[d.latitude, d.longitude]}
            radius={(rank >= 1 ? 6 + 2 * rank : 4) + (isSelected ? 3 : 0)}
            pathOptions={{
              color: isSelected ? '#0f172a' : '#ffffff',
              weight: isSelected ? 2.5 : 1,
              fillColor: severityColor(d.severity),
              fillOpacity: rank >= 1 ? 0.95 : 0.7,
            }}
            eventHandlers={{ click: () => onSelect(d.districtId) }}
          >
            <Tooltip>
              <strong>{d.districtName}</strong>
              {d.provinceName ? `, ${d.provinceName}` : ''}
              <br />
              {d.severity ? SEVERITY_LABEL[d.severity] : 'No level issued'} · flood {d.flood?.level ?? '—'} · landslide{' '}
              {d.landslide?.level ?? '—'}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

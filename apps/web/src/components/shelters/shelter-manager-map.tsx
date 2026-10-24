'use client';

import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SATELLITE_TILES } from '@/lib/map-tiles';
import { shelterLatLng, SHELTER_KIND_COLORS, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import type { Shelter, ShelterKind } from '@/types/domain';

const INDONESIA_CENTER: [number, number] = [-2.5, 118];

// lucide "tent" and "flag" glyphs as raw SVG for Leaflet divIcons.
const GLYPHS: Record<ShelterKind, string> = {
  posko:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/></svg>',
  assembly_point:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>',
};

function siteIcon(kind: ShelterKind, state: 'active' | 'inactive' | 'selected' | 'draft') {
  const size = state === 'selected' || state === 'draft' ? 38 : 30;
  return leaflet.divIcon({
    className: `shelter-pin is-${state}`,
    html: `<span style="--pin:${SHELTER_KIND_COLORS[kind]}">${GLYPHS[kind]}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyTo({ target }: { target: { lat: number; lng: number; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom, { duration: 0.6 });
  }, [map, target]);
  return null;
}

export interface ShelterManagerMapProps {
  shelters: Shelter[];
  selectedId: string | null;
  /** Point being placed/edited in the form; draggable. */
  draft: { lat: number; lng: number; kind: ShelterKind } | null;
  focus: { lat: number; lng: number; zoom: number } | null;
  onPick: (lat: number, lng: number) => void;
  onSelect: (id: string) => void;
}

export default function ShelterManagerMap({ shelters, selectedId, draft, focus, onPick, onSelect }: ShelterManagerMapProps) {
  return (
    <MapContainer
      center={INDONESIA_CENTER}
      zoom={5}
      scrollWheelZoom
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
      className="z-0 rounded-lg"
    >
      <TileLayer url={SATELLITE_TILES.url} attribution={SATELLITE_TILES.attribution} maxZoom={SATELLITE_TILES.maxZoom} />
      <ZoomControl position="bottomright" />
      <ClickToPlace onPick={onPick} />
      <FlyTo target={focus} />

      {shelters.map((shelter) => {
        if (shelter.id === selectedId && draft) return null;
        const point = shelterLatLng(shelter);
        if (!point) return null;
        return (
          <Marker
            key={shelter.id}
            position={[point.lat, point.lng]}
            icon={siteIcon(shelter.kind, shelter.isActive ? 'active' : 'inactive')}
            eventHandlers={{ click: () => onSelect(shelter.id) }}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {SHELTER_KIND_LABELS[shelter.kind]}: {shelter.name}
              {!shelter.isActive && ' (nonaktif)'}
            </Tooltip>
          </Marker>
        );
      })}

      {draft && (
        <Marker
          position={[draft.lat, draft.lng]}
          icon={siteIcon(draft.kind, 'draft')}
          draggable
          zIndexOffset={1000}
          eventHandlers={{
            dragend: (e) => {
              const { lat, lng } = (e.target as leaflet.Marker).getLatLng();
              onPick(lat, lng);
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -18]} permanent>
            Geser untuk memindahkan titik
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}

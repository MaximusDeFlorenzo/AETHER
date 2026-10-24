'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { MapViewSync } from '@/components/map/map-view-sync';
import leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useHotspotPoints } from '@/hooks/use-hotspots';
import type { NationalEvent } from '@/hooks/use-national-events';
import {
  CITIZEN_ALARM_COLOR,
  CITIZEN_HAZARD_COLORS,
  CITIZEN_SMOKE_COLORS,
  CITIZEN_SHELTER_COLOR,
  CITIZEN_USER_COLOR,
} from '@/lib/chart-colors';
import { eventFact, eventTitle, timeAgo } from '@/lib/citizen/events';
import { googleMapsDirectionsUrl } from '@/lib/citizen/geo';
import { isClusterEvent, type SmokePlume } from '@/lib/citizen/smoke';
import type { PublicAlert } from '@/lib/citizen/types';
import { SHELTER_KIND_COLORS, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import type { ShelterKind } from '@/types/domain';
import { SATELLITE_TILES } from '@/lib/map-tiles';

const INDONESIA_CENTER: [number, number] = [-2.5, 118];

// Satellite basemap (user decision 2026-10-08): green space, forests and
// built-up areas read at a glance. Keyless Esri imagery, as the analyst map.


const FLAME_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z"/></svg>';
const CLOUD_SVG = (color: string) =>
  `<svg viewBox="0 0 64 40" aria-hidden="true"><path fill="${color}" d="M14 38a12 12 0 0 1-1-24A16 16 0 0 1 44 9a11 11 0 0 1 8 6 11 11 0 0 1-2 23z"/></svg>`;
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l7 18-7-4.5L5 20z"/></svg>';

function fireIcon(selected: boolean) {
  return leaflet.divIcon({
    className: `fire-marker${selected ? ' is-selected' : ''}`,
    html: `<span>${FLAME_SVG}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function puffIcon(color: string, size: number) {
  return leaflet.divIcon({
    className: 'smoke-puff',
    html: CLOUD_SVG(color),
    iconSize: [size, Math.round(size * 0.62)],
    iconAnchor: [size / 2, Math.round(size * 0.31)],
  });
}

function arrowIcon(bearing: number) {
  return leaflet.divIcon({
    className: 'wind-arrow',
    html: `<span style="transform: rotate(${bearing}deg)">${ARROW_SVG}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function segmentBearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const y = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const x = b.lat - a.lat;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Individual detections only when zoomed in this far: a zoom-9 viewport is
// ~1.5° wide, a few hundred to ~1,500 detections on a bad fire day.
const POINTS_MIN_ZOOM = 9;
const MAX_BBOX_SIDE_DEG = 10;
const CONFIDENCE_LABEL = { high: 'tinggi', nominal: 'sedang', low: 'rendah' } as const;

/** Every FIRMS detection in the viewport once zoomed in (clusters stay as
 * fire icons/dots further out). */
function HotspotPointsLayer() {
  const map = useMap();
  const viewport = () => {
    if (map.getZoom() < POINTS_MIN_ZOOM) return null;
    const b = map.getBounds();
    const west = b.getWest();
    const south = b.getSouth();
    return [
      west,
      south,
      Math.min(b.getEast(), west + MAX_BBOX_SIDE_DEG),
      Math.min(b.getNorth(), south + MAX_BBOX_SIDE_DEG),
    ] as [number, number, number, number];
  };
  const [bbox, setBbox] = useState(viewport);
  useMapEvents({ moveend: () => setBbox(viewport()) });
  const points = useHotspotPoints(bbox);
  if (!bbox) return null;

  return (
    <>
      {(points.data?.points ?? []).map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.latitude, point.longitude]}
          radius={4}
          pathOptions={{
            color: '#ffffff',
            weight: 1,
            fillColor: CITIZEN_HAZARD_COLORS.wildfire,
            fillOpacity: point.confidenceClass === 'high' ? 1 : 0.75,
          }}
        >
          <Popup>
            <div className="grid gap-1 font-citizen">
              <strong className="text-sm">Deteksi panas · {point.sensor}</strong>
              <span className="text-xs">
                {[
                  timeAgo(point.observedAt),
                  point.confidenceClass && `keyakinan ${CONFIDENCE_LABEL[point.confidenceClass]}`,
                  point.frpMw !== null && `${point.frpMw.toLocaleString('id-ID', { maximumFractionDigits: 1 })} MW`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="text-xs">Titik panas dari satelit, belum tentu api yang terkonfirmasi.</span>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

/** Flies the map to `focus` whenever it changes (tap a fire → go there). */
function MapFocus({ focus }: { focus: { lat: number; lng: number; zoom: number; key: string } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fly only when the focus target changes
  }, [focus?.key, map]);
  return null;
}

function SmokeLayer({
  plume,
  color,
  selected,
  onSelect,
}: {
  plume: SmokePlume;
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const line = plume.centerline;
  const arrows = useMemo(
    () =>
      line.slice(0, -1).flatMap((point, index) => {
        const step = Math.max(1, Math.round(line.length / 4));
        if (index % step !== 0) return [];
        const next = line[index + 1];
        return [{ lat: (point.lat + next.lat) / 2, lng: (point.lng + next.lng) / 2, bearing: segmentBearing(point, next) }];
      }),
    [line],
  );
  const puffs = [line[Math.floor(line.length / 3)], line[Math.floor((line.length * 2) / 3)], line[line.length - 1]];
  const click = { click: onSelect };

  return (
    <>
      <Polygon positions={plume.outline} pathOptions={{ stroke: false, fillColor: color, fillOpacity: selected ? 0.22 : 0.14 }} eventHandlers={click} />
      <Polygon positions={plume.denser} pathOptions={{ stroke: false, fillColor: color, fillOpacity: selected ? 0.22 : 0.14 }} eventHandlers={click} />
      <Polygon
        positions={plume.densest}
        pathOptions={{
          fillColor: color,
          fillOpacity: selected ? 0.28 : 0.18,
          color,
          weight: selected ? 2 : 0,
          dashArray: '4 6',
        }}
        eventHandlers={click}
      />
      {puffs.map((point, index) =>
        point ? (
          <Marker
            key={`puff-${index}`}
            position={[point.lat, point.lng]}
            icon={puffIcon(color, 26 + index * 10)}
            interactive={false}
            keyboard={false}
          />
        ) : null,
      )}
      {arrows.map((arrow, index) => (
        <Marker key={`arrow-${index}`} position={[arrow.lat, arrow.lng]} icon={arrowIcon(arrow.bearing)} interactive={false} keyboard={false} />
      ))}
    </>
  );
}

export interface MapShelter {
  id: string;
  name: string;
  kind: ShelterKind;
  lat: number;
  lng: number;
  capacity: number;
}

export function CitizenMap({
  events,
  user,
  shelters,
  alerts,
  plumes = [],
  selectedFireId = null,
  onSelectFire,
  focus = null,
  showHotspotPoints = false,
}: {
  events: NationalEvent[];
  user: { lat: number; lng: number; label: string } | null;
  shelters: MapShelter[];
  alerts: PublicAlert[];
  /** When non-empty, wildfires are drawn as fire icons + smoke instead of dots. */
  plumes?: SmokePlume[];
  selectedFireId?: string | null;
  onSelectFire?: (fireId: string) => void;
  focus?: { lat: number; lng: number; zoom: number; key: string } | null;
  /** Individual FIRMS detections when zoomed in. */
  showHotspotPoints?: boolean;
}) {
  // Light smoke on dark imagery in either theme.
  const smokeColor = CITIZEN_SMOKE_COLORS.dark;
  const showSmoke = plumes.length > 0;
  const center: [number, number] = user ? [user.lat, user.lng] : INDONESIA_CENTER;
  const zoom = user ? 8 : 5;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
      className="z-0 rounded-[inherit]"
    >
      <MapViewSync center={center} zoom={zoom} />
      <TileLayer
        url={SATELLITE_TILES.url}
        attribution={SATELLITE_TILES.attribution}
        maxZoom={SATELLITE_TILES.maxZoom}
      />
      <ZoomControl position="bottomright" />
      <MapFocus focus={focus} />

      {plumes.map((plume) => (
        <SmokeLayer
          key={`smoke-${plume.fire.id}`}
          plume={plume}
          color={smokeColor}
          selected={plume.fire.id === selectedFireId}
          onSelect={() => onSelectFire?.(plume.fire.id)}
        />
      ))}

      {events
        .filter(({ event }) => !(showSmoke && event.hazardType === 'wildfire'))
        .map(({ event, proximity }) => (
        <CircleMarker
          key={event.id}
          center={[event.latitude, event.longitude]}
          radius={proximity.near ? 10 : 7}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: CITIZEN_HAZARD_COLORS[event.hazardType],
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div className="grid gap-1 font-citizen">
              <strong className="text-sm">{eventTitle(event)}</strong>
              <span className="text-xs">{[eventFact(event), timeAgo(event.eventTime)].filter(Boolean).join(' · ')}</span>
              {isClusterEvent(event) && <span className="text-xs">Satelit: {event.cluster.sensors.join(', ')}</span>}
              <span className="text-xs">{proximity.label}</span>
              <Link href={`/kejadian/${event.id}`} className="text-xs font-bold">
                Lihat detail →
              </Link>
            </div>
          </Popup>
        </CircleMarker>
        ))}

      {showHotspotPoints && <HotspotPointsLayer />}

      {plumes.map((plume) => (
        <Fragment key={`fire-${plume.fire.id}`}>
          <Marker
            position={[plume.fire.lat, plume.fire.lng]}
            icon={fireIcon(plume.fire.id === selectedFireId)}
            title={`Titik api: ${plume.fire.label}`}
            eventHandlers={{ click: () => onSelectFire?.(plume.fire.id) }}
          />
        </Fragment>
      ))}

      {shelters.map((shelter) => (
        <CircleMarker
          key={shelter.id}
          center={[shelter.lat, shelter.lng]}
          radius={8}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: shelter.kind === 'assembly_point' ? SHELTER_KIND_COLORS.assembly_point : CITIZEN_SHELTER_COLOR,
            fillOpacity: 1,
          }}
        >
          <Popup>
            <div className="grid gap-1 font-citizen">
              <strong className="text-sm">
                {SHELTER_KIND_LABELS[shelter.kind]}: {shelter.name}
              </strong>
              {shelter.capacity > 0 && (
                <span className="text-xs">Kapasitas {shelter.capacity.toLocaleString('id-ID')} orang</span>
              )}
              <a href={googleMapsDirectionsUrl(shelter.lat, shelter.lng)} target="_blank" rel="noopener noreferrer" className="text-xs font-bold">
                Rute jalan kaki →
              </a>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {alerts
        .filter((alert) => alert.destinationLatitude !== null && alert.destinationLongitude !== null)
        .map((alert) => (
          <CircleMarker
            key={alert.id}
            center={[alert.destinationLatitude!, alert.destinationLongitude!]}
            radius={11}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: CITIZEN_ALARM_COLOR, fillOpacity: 1 }}
          >
            <Popup>
              <div className="grid gap-1 font-citizen">
                <strong className="text-sm">Tujuan evakuasi: {alert.destinationName}</strong>
                <span className="text-xs">{alert.title}</span>
              </div>
            </Popup>
          </CircleMarker>
        ))}

      {user && (
        <CircleMarker
          center={[user.lat, user.lng]}
          radius={9}
          pathOptions={{ color: '#ffffff', weight: 3, fillColor: CITIZEN_USER_COLOR, fillOpacity: 1 }}
        >
          <Popup>
            <div className="font-citizen text-sm">
              <strong>{user.label}</strong>
              <br />
              <span className="text-xs">Titik pusat kabupaten/kota, bukan alamat Anda.</span>
            </div>
          </Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}

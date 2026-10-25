'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/lib/leaflet-attribution';
import { formatDistanceToNowStrict } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { googleMapsDirectionsUrl } from '@/lib/citizen/geo';
import type { PublicAlertResponses } from '@/lib/citizen/types';
import { cartoTileUrl } from '@/lib/map-tiles';

type HelpRequest = PublicAlertResponses['needsHelp'][number];

const HELP_COLOR = '#c1121f';
const DESTINATION_COLOR = '#1f8a4c';
// Team already on the way ("petugas dikerahkan").
const DISPATCHED_COLOR = '#c2570c';

function FitToPoints({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const key = points.map((point) => point.join(',')).join(';');
  useEffect(() => {
    if (points.length === 0 || !map.getPane('mapPane')) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the set of points changes
  }, [key, map]);
  return null;
}

/** Where the citizens who pressed "Butuh bantuan" are (latest shared
 * location, refreshed while their help screen is open), plus the alarm's
 * evacuation destination, so a field team can plan pick-ups at a glance. */
export function HelpRequestsMap({
  requests,
  destination,
}: {
  requests: HelpRequest[];
  destination: { name: string; lat: number; lng: number } | null;
}) {
  const located = requests.filter(
    (request): request is HelpRequest & { latitude: number; longitude: number } =>
      request.latitude !== null && request.longitude !== null,
  );
  const points: Array<[number, number]> = located.map((request) => [request.latitude, request.longitude]);
  if (destination) points.push([destination.lat, destination.lng]);

  return (
    <MapContainer
      center={points[0] ?? [-2.5, 118]}
      zoom={points.length ? 13 : 5}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
      className="z-0 rounded-[inherit]"
    >
      <TileLayer
        url={cartoTileUrl('voyager')}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <FitToPoints points={points} />
      {destination && (
        <CircleMarker
          center={[destination.lat, destination.lng]}
          radius={9}
          pathOptions={{ color: '#ffffff', weight: 3, fillColor: DESTINATION_COLOR, fillOpacity: 1 }}
        >
          <Tooltip direction="top">Tujuan evakuasi: {destination.name}</Tooltip>
        </CircleMarker>
      )}
      {located.map((request) => {
        // Same number as in the list (which also has requests without a location).
        const number = requests.indexOf(request) + 1;
        return (
        <CircleMarker
          key={request.id}
          center={[request.latitude, request.longitude]}
          radius={10}
          pathOptions={{
            color: '#ffffff',
            weight: 3,
            fillColor: request.handling === 'dispatched' ? DISPATCHED_COLOR : HELP_COLOR,
            fillOpacity: 1,
          }}
        >
          <Tooltip permanent direction="right" offset={[10, 0]}>
            {number}
          </Tooltip>
          <Popup>
            <div className="grid gap-1 text-sm">
              <strong>
                Permintaan #{number}
                {request.handling === 'dispatched' ? ' · petugas dikerahkan' : ''}
              </strong>
              {request.peopleCount !== null && <span>{request.peopleCount} orang</span>}
              {request.note && <span>{request.note}</span>}
              {request.contactPhone && (
                <a href={`tel:${request.contactPhone.replace(/[^\d+]/g, '')}`}>{request.contactPhone}</a>
              )}
              <span className="text-xs">
                Lokasi diperbarui{' '}
                {formatDistanceToNowStrict(new Date(request.updatedAt), { addSuffix: true, locale: localeId })}
              </span>
              <a href={googleMapsDirectionsUrl(request.latitude, request.longitude)} target="_blank" rel="noopener noreferrer">
                Rute ke lokasi →
              </a>
            </div>
          </Popup>
        </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

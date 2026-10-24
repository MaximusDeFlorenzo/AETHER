'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Moves an existing map to `center`/`zoom` when they change. MapContainer
 * only reads its center/zoom props on mount, and remounting it (a changing
 * `key`) while a zoom animation is running makes Leaflet's pending
 * `_onZoomTransitionEnd` touch the removed map pane — "Cannot read
 * properties of undefined (reading '_leaflet_pos')".
 */
export function MapViewSync({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  const [lat, lng] = center;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    map.stop();
    map.setView([lat, lng], zoom, { animate: true });
  }, [map, lat, lng, zoom]);

  return null;
}

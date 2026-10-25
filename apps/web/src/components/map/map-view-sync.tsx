'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Moves an existing map to `center`/`zoom` when they change. MapContainer
 * only reads its center/zoom props on mount, and remounting it (a changing
 * `key`) while a zoom animation is running makes Leaflet's pending
 * `_onZoomTransitionEnd` touch the removed map pane — "Cannot read
 * properties of undefined (reading '_leaflet_pos')".
 *
 * The last applied view is compared by value rather than skipping the first
 * run: React Strict Mode runs effects twice on mount, and a "skip once" flag
 * let the second run animate a freshly created map, which then crashed the
 * same way if the map unmounted mid-animation.
 */
export function MapViewSync({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  const [lat, lng] = center;
  const applied = useRef({ lat, lng, zoom });

  useEffect(() => {
    const last = applied.current;
    if (last.lat === lat && last.lng === lng && last.zoom === zoom) return;
    applied.current = { lat, lng, zoom };
    // A map whose panes are already torn down can't be moved.
    if (!map.getPane('mapPane')) return;
    map.stop();
    map.setView([lat, lng], zoom, { animate: true });
  }, [map, lat, lng, zoom]);

  return null;
}

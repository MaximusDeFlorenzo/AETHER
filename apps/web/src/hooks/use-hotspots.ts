import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { HotspotMap, HotspotPoint } from '@/types/fire';

/**
 * Clustered FIRMS hotspots (MODIS + VIIRS) for the last 24 h: the strongest
 * 300 fire areas plus every one within 150 km of the citizen.
 */
export function useHotspotMap(user: { lat: number; lng: number } | null) {
  const lat = user ? Number(user.lat.toFixed(2)) : undefined;
  const lng = user ? Number(user.lng.toFixed(2)) : undefined;
  return useQuery({
    queryKey: ['public-hotspots', { lat, lng }],
    queryFn: async () => {
      const { data } = await apiClient.get<HotspotMap>('/public/hotspots', { params: { lat, lng } });
      return data;
    },
    refetchInterval: 5 * 60_000,
  });
}

/** Individual detections inside the map viewport (only when zoomed in). */
export function useHotspotPoints(bbox: [number, number, number, number] | null) {
  const param = bbox?.map((v) => v.toFixed(2)).join(',');
  return useQuery({
    queryKey: ['public-hotspot-points', param],
    queryFn: async () => {
      const { data } = await apiClient.get<{ points: HotspotPoint[]; truncated: boolean }>('/public/hotspots/points', {
        params: { bbox: param },
      });
      return data;
    },
    enabled: Boolean(param),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

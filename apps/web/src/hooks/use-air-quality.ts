import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PointAirQuality, StationAirQuality } from '@/types/air-quality';

/** Modelled air quality at each point, same order; a failed point is null. */
export function useAirQuality(points: Array<{ lat: number; lng: number }>) {
  const param = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join(';');
  return useQuery({
    queryKey: ['public-air-quality', param],
    queryFn: async () => {
      const { data } = await apiClient.get<Array<PointAirQuality | null>>('/public/air-quality', {
        params: { points: param },
      });
      return data;
    },
    enabled: points.length > 0,
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

/** Measured reading from the nearest active OpenAQ station, null when none. */
export function useNearestStation(point: { lat: number; lng: number } | null) {
  const lat = point ? Number(point.lat.toFixed(3)) : undefined;
  const lng = point ? Number(point.lng.toFixed(3)) : undefined;
  return useQuery({
    queryKey: ['public-air-quality-station', { lat, lng }],
    queryFn: async () => {
      const { data } = await apiClient.get<StationAirQuality | ''>('/public/air-quality/station', {
        params: { lat, lng },
      });
      return data || null;
    },
    enabled: !!point,
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

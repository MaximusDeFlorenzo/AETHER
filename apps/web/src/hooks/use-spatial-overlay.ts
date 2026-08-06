import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { HazardType, SpatialOverlayFeatureCollection, SpatialOverlayLayer } from '@/types/domain';

export interface SpatialOverlayFilters {
  layer: SpatialOverlayLayer;
  hazardType?: HazardType;
  bbox?: string;
}

// GeoJSON polygon overlay for risk/vulnerability/exposure zones — the
// endpoint ORION never had (it only ever served earthquake point data).
// Public, no auth required (docs/API_SPEC.md §6).
export function useSpatialOverlay(filters: SpatialOverlayFilters, enabled = true) {
  return useQuery({
    queryKey: ['spatial-overlay', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<SpatialOverlayFeatureCollection>('/spatial/overlay', {
        params: filters,
      });
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

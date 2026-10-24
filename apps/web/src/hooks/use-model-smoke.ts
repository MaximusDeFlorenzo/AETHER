import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ModelSmoke } from '@/types/fire';

/** Latest karhutla smoke forecast (particle model, top fires only) for the
 * horizon closest to `hours` from now, plus whether it reaches the citizen. */
export function useModelSmoke(hours: number, user: { lat: number; lng: number } | null, enabled = true) {
  const lat = user ? Number(user.lat.toFixed(3)) : undefined;
  const lng = user ? Number(user.lng.toFixed(3)) : undefined;
  return useQuery({
    queryKey: ['public-smoke', { hours, lat, lng }],
    queryFn: async () => {
      const { data } = await apiClient.get<ModelSmoke>('/public/smoke/latest', { params: { hours, lat, lng } });
      return data;
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { RainfallOutlook } from '@/types/rainfall';

// GSMaP rain fields arrive hourly and risk runs follow them, so a few
// minutes between refetches is plenty.
const REFETCH_MS = 5 * 60_000;

/** Every district, compact (levels and recommendation codes only). */
export function useRainfallOutlook() {
  return useQuery({
    queryKey: ['rainfall', 'outlook'],
    queryFn: async () => {
      const { data } = await apiClient.get<RainfallOutlook>('/rainfall/outlook', { params: { compact: true } });
      return data;
    },
    refetchInterval: REFETCH_MS,
  });
}

/** One district with recommendations and confidence reasons. */
export function useRainfallDistrictOutlook(districtId: string | null) {
  return useQuery({
    queryKey: ['rainfall', 'outlook', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<RainfallOutlook>(`/rainfall/outlook/${districtId}`);
      return data.districts[0] ?? null;
    },
    enabled: Boolean(districtId),
    refetchInterval: REFETCH_MS,
  });
}

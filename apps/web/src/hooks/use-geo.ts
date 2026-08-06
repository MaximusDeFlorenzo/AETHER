import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { District, PopulationStatistic, Province } from '@/types/domain';

// Renamed from ORION's `population/` module to `geo/` per
// docs/MIGRATION_FROM_ORION.md — same shapes, reused near-verbatim.
export function useProvinces() {
  return useQuery({
    queryKey: ['provinces'],
    queryFn: async () => {
      const { data } = await apiClient.get<Province[]>('/provinces');
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function useDistricts(provinceId?: string) {
  return useQuery({
    queryKey: ['districts', provinceId],
    queryFn: async () => {
      const { data } = await apiClient.get<District[]>('/districts', {
        params: provinceId ? { province: provinceId } : undefined,
      });
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function usePopulation(districtId: string | undefined) {
  return useQuery({
    queryKey: ['population', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<PopulationStatistic>(`/population/${districtId}`);
      return data;
    },
    enabled: !!districtId,
  });
}

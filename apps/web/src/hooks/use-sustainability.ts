import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { SustainabilityMetrics } from '@/types/domain';

export interface SustainabilityFilters {
  district?: string;
  periodStart?: string;
  periodEnd?: string;
}

// Public accountability dashboard, no auth required (docs/API_SPEC.md §8) —
// new in AETHER, ORION never had a sustainability/SDG surface.
export function useSustainabilityMetrics(filters: SustainabilityFilters = {}) {
  return useQuery({
    queryKey: ['sustainability-metrics', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<SustainabilityMetrics>('/sustainability-metrics', {
        params: filters,
      });
      return data;
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { DashboardSummary, HazardType } from '@/types/domain';

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<DashboardSummary>('/dashboard');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  province?: string;
  hazardType?: HazardType;
}

export interface AnalyticsResponse {
  hazardEventCountsByDay: { date: string; count: number }[];
  hazardTypeDistribution: { hazardType: HazardType; count: number }[];
  historicalCasualtiesByYear: { year: string; totalDeaths: number; totalDamagedBuildings: number }[];
}

export function useAnalytics(filters: AnalyticsFilters = {}) {
  return useQuery({
    queryKey: ['analytics', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<AnalyticsResponse>('/analytics', { params: filters });
      return data;
    },
  });
}

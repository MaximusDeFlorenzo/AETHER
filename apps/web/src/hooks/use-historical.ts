import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { HazardType, HistoricalDisaster, PaginatedResponse } from '@/types/domain';

export interface HistoricalFilters {
  hazardType?: HazardType;
  province?: string;
  district?: string;
  minSeverity?: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export function useHistoricalDisasters(filters: HistoricalFilters = {}) {
  return useQuery({
    queryKey: ['historical', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<HistoricalDisaster>>('/historical', {
        params: filters,
      });
      return data;
    },
  });
}

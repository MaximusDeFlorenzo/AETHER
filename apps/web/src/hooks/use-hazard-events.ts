import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AffectedPopulationEstimate,
  AffectedRegion,
  HazardEvent,
  HazardEventDetail,
  HazardRelationship,
  HazardType,
  PaginatedResponse,
} from '@/types/domain';

export interface HazardEventFilters {
  hazardType?: HazardType;
  minSeverity?: number;
  from?: string;
  to?: string;
  province?: string;
  page?: number;
  limit?: number;
}

export function useHazardEvents(filters: HazardEventFilters = {}) {
  return useQuery({
    queryKey: ['hazard-events', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<HazardEvent>>('/hazard-events', {
        params: filters,
      });
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useHazardEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['hazard-events', id],
    queryFn: async () => {
      const { data } = await apiClient.get<HazardEventDetail>(`/hazard-events/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useHazardEventRelationships(id: string | undefined) {
  return useQuery({
    queryKey: ['hazard-events', id, 'relationships'],
    queryFn: async () => {
      const { data } = await apiClient.get<HazardRelationship[]>(`/hazard-events/${id}/relationships`);
      return data;
    },
    enabled: !!id,
  });
}

export function useAffectedRegions(hazardEventId: string | undefined) {
  return useQuery({
    queryKey: ['hazard-events', hazardEventId, 'affected-regions'],
    queryFn: async () => {
      const { data } = await apiClient.get<AffectedRegion[]>(
        `/hazard-events/${hazardEventId}/affected-regions`,
      );
      return data;
    },
    enabled: !!hazardEventId,
  });
}

export function useAffectedPopulation(hazardEventId: string | undefined) {
  return useQuery({
    queryKey: ['hazard-events', hazardEventId, 'affected-population'],
    queryFn: async () => {
      const { data } = await apiClient.get<AffectedPopulationEstimate>(
        `/hazard-events/${hazardEventId}/affected-population`,
      );
      return data;
    },
    enabled: !!hazardEventId,
  });
}

export function useSyncHazardEvents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (source: string) => {
      const { data } = await apiClient.post<{ message: string; newEventsIngested: number }>(
        `/hazard-events/${source}/sync`,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hazard-events'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

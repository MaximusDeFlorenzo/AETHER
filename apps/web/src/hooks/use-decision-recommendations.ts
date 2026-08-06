import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { DecisionRecommendation, HazardType, PaginatedResponse, PriorityLevel } from '@/types/domain';

export interface DecisionRecommendationFilters {
  priorityLevel?: PriorityLevel;
  hazardType?: HazardType;
  page?: number;
  limit?: number;
}

export function useDecisionRecommendations(filters: DecisionRecommendationFilters = {}) {
  return useQuery({
    queryKey: ['decision-recommendations', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<DecisionRecommendation>>(
        '/decision-recommendations',
        { params: filters },
      );
      return data;
    },
    refetchInterval: 15_000,
  });
}

export function useDecisionRecommendation(id: string | undefined) {
  return useQuery({
    queryKey: ['decision-recommendations', id],
    queryFn: async () => {
      const { data } = await apiClient.get<DecisionRecommendation>(`/decision-recommendations/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { DecisionRecommendation, HazardType, PaginatedResponse, PriorityLevel } from '@/types/domain';

export interface DecisionRecommendationFilters {
  priorityLevel?: PriorityLevel;
  hazardType?: HazardType;
  hazardEventId?: string;
  page?: number;
  limit?: number;
}

// GET /decision-recommendations is a public, unauthenticated endpoint
// (docs/API_SPEC.md's guard posture) — `enabled` exists only for callers
// that need to defer the fetch for unrelated reasons (e.g. waiting on
// another query), not for auth gating.
export function useDecisionRecommendations(filters: DecisionRecommendationFilters = {}, enabled = true) {
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
    enabled,
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

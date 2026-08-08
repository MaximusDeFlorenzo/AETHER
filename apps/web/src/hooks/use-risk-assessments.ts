import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { HazardType, PaginatedResponse, RiskAssessment } from '@/types/domain';

export interface RiskAssessmentFilters {
  hazardType?: HazardType;
  district?: string;
  minRiskScore?: number;
  /** Filter to `hazardEventId IS NULL` standing/baseline assessments — the
   * event-independent prediction/prevention scoring ORION never had
   * (docs/ARCHITECTURE.md §2.2). */
  baseline?: boolean;
  page?: number;
  limit?: number;
}

// `enabled` defaults true for the (workspace) risk-assessments page (always
// behind AuthGuard); the public dashboard passes `enabled: !!accessToken`
// since this endpoint 401s for anonymous requests (docs/API_SPEC.md's guard
// posture) and the global 401 handler would otherwise hard-redirect every
// signed-out visitor to /admin/login.
export function useRiskAssessments(filters: RiskAssessmentFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ['risk-assessments', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<RiskAssessment>>('/risk-assessments', {
        params: filters,
      });
      return data;
    },
    refetchInterval: 15_000,
    enabled,
  });
}

export function useRiskAssessment(id: string | undefined) {
  return useQuery({
    queryKey: ['risk-assessments', id],
    queryFn: async () => {
      const { data } = await apiClient.get<RiskAssessment>(`/risk-assessments/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

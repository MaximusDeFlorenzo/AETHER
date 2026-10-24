import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { computeRegionStatus, type RegionStatus } from '@/lib/citizen/status';
import type { CitizenLocation } from '@/lib/citizen/types';
import type { PaginatedResponse, RiskAssessment } from '@/types/domain';
import { useActiveAlerts } from './use-public-alerts';

// Enough rows to cover every event-driven + baseline assessment a single
// district realistically accumulates within the 24h window.
const ASSESSMENT_LIMIT = 100;

export function useDistrictAssessments(districtId: string | undefined) {
  return useQuery({
    queryKey: ['citizen', 'district-assessments', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<RiskAssessment>>('/risk-assessments', {
        params: { district: districtId, limit: ASSESSMENT_LIMIT },
      });
      return data.data;
    },
    enabled: !!districtId,
    refetchInterval: 60_000,
  });
}

export function useRegionStatus(location: CitizenLocation | null): {
  status: RegionStatus | null;
  isLoading: boolean;
  isError: boolean;
} {
  const assessments = useDistrictAssessments(location?.districtId);
  const alerts = useActiveAlerts(location);

  const status = useMemo(() => {
    if (!location || !assessments.data) return null;
    return computeRegionStatus(assessments.data, alerts.data ?? []);
  }, [location, assessments.data, alerts.data]);

  return {
    status,
    isLoading: !!location && (assessments.isLoading || alerts.isLoading),
    // Alerts failing alone shouldn't blank the status — assessments are the
    // primary input; an unreachable alarm feed is surfaced separately.
    isError: assessments.isError,
  };
}

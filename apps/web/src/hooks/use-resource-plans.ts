import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  HazardType,
  PaginatedResponse,
  ResourceOptimizationPlan,
  ResourceOptimizationPlanInput,
  Shelter,
} from '@/types/domain';

export interface ResourcePlanFilters {
  hazardType?: HazardType;
  district?: string;
  page?: number;
  limit?: number;
}

export function useResourceOptimizationPlans(filters: ResourcePlanFilters = {}) {
  return useQuery({
    queryKey: ['resource-optimization-plans', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<ResourceOptimizationPlan>>(
        '/resource-optimization-plans',
        { params: filters },
      );
      return data;
    },
  });
}

export function useCreateResourceOptimizationPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ResourceOptimizationPlanInput) => {
      const { data } = await apiClient.post<ResourceOptimizationPlan>(
        '/resource-optimization-plans',
        payload,
      );
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['resource-optimization-plans'] }),
  });
}

export function useShelters(district?: string) {
  return useQuery({
    queryKey: ['shelters', district],
    queryFn: async () => {
      const { data } = await apiClient.get<Shelter[]>('/shelters', {
        params: district ? { district } : undefined,
      });
      return data;
    },
  });
}

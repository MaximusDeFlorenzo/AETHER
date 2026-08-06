import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  CvDetection,
  CvDetectionType,
  FieldReportSubmissionInput,
  FieldReportSubmissionResult,
  PaginatedResponse,
} from '@/types/domain';

export interface FieldReportFilters {
  detectionType?: CvDetectionType;
  page?: number;
  limit?: number;
}

export function useFieldReports(filters: FieldReportFilters = {}) {
  return useQuery({
    queryKey: ['field-reports', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<CvDetection>>('/field-reports', {
        params: filters,
      });
      return data;
    },
  });
}

export function useFieldReport(id: string | undefined) {
  return useQuery({
    queryKey: ['field-reports', id],
    queryFn: async () => {
      const { data } = await apiClient.get<CvDetection & { imageUrl: string }>(
        `/field-reports/${id}`,
      );
      return data;
    },
    enabled: !!id,
  });
}

export function useSubmitFieldReport() {
  const queryClient = useQueryClient();

  return useMutation({
    // axios recognizes FormData automatically and sets the multipart
    // Content-Type + boundary itself — no api-client.ts changes needed.
    mutationFn: async (input: FieldReportSubmissionInput) => {
      const formData = new FormData();
      formData.append('image', input.image);
      if (input.hazardTypeHint) formData.append('hazardTypeHint', input.hazardTypeHint);
      if (input.latitude != null) formData.append('latitude', String(input.latitude));
      if (input.longitude != null) formData.append('longitude', String(input.longitude));
      if (input.notes) formData.append('notes', input.notes);

      const { data } = await apiClient.post<FieldReportSubmissionResult>(
        '/field-reports',
        formData,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field-reports'] });
    },
  });
}

export function useLinkFieldReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, hazardEventId }: { id: string; hazardEventId: string }) => {
      const { data } = await apiClient.patch<CvDetection>(`/field-reports/${id}/link`, {
        hazardEventId,
      });
      return data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['field-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['field-reports', variables.id] });
    },
  });
}

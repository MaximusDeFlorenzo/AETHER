import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PaginatedResponse } from '@/types/domain';
import type {
  GroundObservationType,
  GroundReportDetail,
  GroundReportStatus,
  GroundReportSubmissionInput,
  GroundReportSummary,
} from '@/types/ground-reports';

export interface GroundReportFilters {
  status?: GroundReportStatus;
  observationType?: GroundObservationType;
  page?: number;
  limit?: number;
}

/** The API's own validation message (400/409/429), falling back to a generic one. */
export function groundReportErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)
      ?.message;
    if (Array.isArray(message)) return message.join('; ');
    if (message) return message;
  }
  return fallback;
}

export function useGroundReports(filters: GroundReportFilters = {}) {
  return useQuery({
    queryKey: ['ground-reports', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<GroundReportSummary>>(
        '/ground-reports',
        { params: filters },
      );
      return data;
    },
  });
}

export function useGroundReport(id: string | undefined) {
  return useQuery({
    queryKey: ['ground-reports', 'detail', id],
    queryFn: async () => {
      const { data } = await apiClient.get<GroundReportDetail>(`/ground-reports/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useSubmitGroundReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GroundReportSubmissionInput) => {
      const formData = new FormData();
      formData.append('observationType', input.observationType);
      formData.append('latitude', String(input.latitude));
      formData.append('longitude', String(input.longitude));
      formData.append('observedAt', input.observedAt);
      formData.append('description', input.description);
      if (input.waterDepthCm != null) formData.append('waterDepthCm', String(input.waterDepthCm));
      if (input.reporterSeverity) formData.append('reporterSeverity', input.reporterSeverity);
      for (const image of input.images) formData.append('images', image);
      const { data } = await apiClient.post<GroundReportDetail>('/ground-reports', formData);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ground-reports'] });
    },
  });
}

export function useAddGroundReportEvidence(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (images: File[]) => {
      const formData = new FormData();
      for (const image of images) formData.append('images', image);
      const { data } = await apiClient.post<GroundReportDetail>(
        `/ground-reports/${id}/evidence`,
        formData,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ground-reports'] });
    },
  });
}

export function useTransitionGroundReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { to: GroundReportStatus; reason?: string; notes?: string }) => {
      const { data } = await apiClient.post<GroundReportDetail>(
        `/ground-reports/${id}/transitions`,
        input,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ground-reports'] });
    },
  });
}

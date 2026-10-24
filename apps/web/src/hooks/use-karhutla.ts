import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { KarhutlaLatest, KarhutlaRun, KarhutlaVerification } from '@/types/karhutla';

export function useKarhutlaLatest() {
  return useQuery({
    queryKey: ['karhutla', 'latest'],
    queryFn: async () => {
      const { data } = await apiClient.get<KarhutlaLatest>('/karhutla/predictions/latest');
      return data;
    },
    // Poll quickly only while a run is in progress.
    refetchInterval: (query) => (query.state.data?.activeRun ? 5_000 : 60_000),
  });
}

export function useKarhutlaVerification(runId: string | undefined) {
  return useQuery({
    queryKey: ['karhutla', 'verification', runId],
    queryFn: async () => {
      const { data } = await apiClient.get<KarhutlaVerification>(`/karhutla/predictions/runs/${runId}/verification`);
      return data;
    },
    enabled: Boolean(runId),
    refetchInterval: 5 * 60_000,
  });
}

export function useRequestKarhutlaRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { horizonsHours?: number[]; maxClusters?: number }) => {
      const { data } = await apiClient.post<{ run: KarhutlaRun; deduplicated: boolean }>(
        '/karhutla/predictions/runs',
        body,
      );
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['karhutla'] }),
  });
}

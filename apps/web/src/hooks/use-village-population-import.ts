import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  Paginated,
  PopulationImportRowResolutionAction,
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
  VillagePopulation,
  VillagePopulationImportBatch,
  VillagePopulationImportRow,
} from '@/types/domain';

export interface CreateImportBatchInput {
  file: File;
  hasHeaderRow: boolean;
  numberFormat: PopulationNumberFormat;
  sourceName: string;
  sourceReference?: string;
  periodStatus: PopulationPeriodStatus;
  periodYear?: number;
}

export function useCreateImportBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateImportBatchInput) => {
      const formData = new FormData();
      formData.append('file', input.file);
      // Literal 'true'/'false' strings — the backend DTO checks the exact
      // string, not JS truthiness (a naive @Type(() => Boolean) on the
      // backend previously turned "false" into `true`; fixed, but this
      // still sends the unambiguous literal rather than relying on it).
      formData.append('hasHeaderRow', input.hasHeaderRow ? 'true' : 'false');
      formData.append('numberFormat', input.numberFormat);
      formData.append('sourceName', input.sourceName);
      if (input.sourceReference) formData.append('sourceReference', input.sourceReference);
      formData.append('periodStatus', input.periodStatus);
      if (input.periodYear != null) formData.append('periodYear', String(input.periodYear));

      const { data } = await apiClient.post<VillagePopulationImportBatch>(
        '/village-population-imports',
        formData,
      );
      return data;
    },
    onSuccess: (batch) => {
      queryClient.setQueryData(['village-population-import-batch', batch.id], batch);
    },
  });
}

const NON_TERMINAL_STATUSES = new Set<VillagePopulationImportBatch['status']>([
  'uploaded',
  'validating',
  'ready', // not itself progressing, but the user may confirm from another tab
  'queued',
  'importing',
]);

// Polls while the batch hasn't reached a terminal state — validation and
// import now run as BullMQ background jobs (see README-worker.md), so a
// batch can sit in 'uploaded'/'validating'/'queued'/'importing' for a
// while on a large file. The batch row is always reopenable via this same
// GET regardless of whether the client that created it is still around —
// navigating away and back just resumes polling from whatever the current
// status is.
export function useImportBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: ['village-population-import-batch', batchId],
    queryFn: async () => {
      const { data } = await apiClient.get<VillagePopulationImportBatch>(
        `/village-population-imports/${batchId}`,
      );
      return data;
    },
    enabled: !!batchId,
    refetchInterval: (query) =>
      query.state.data && NON_TERMINAL_STATUSES.has(query.state.data.status) ? 1500 : false,
  });
}

export function useImportBatchRows(
  batchId: string | undefined,
  params: { status?: PopulationImportRowStatus; page?: number; limit?: number } = {},
) {
  return useQuery({
    queryKey: ['village-population-import-rows', batchId, params],
    queryFn: async () => {
      const { data } = await apiClient.get<Paginated<VillagePopulationImportRow>>(
        `/village-population-imports/${batchId}/rows`,
        { params },
      );
      return data;
    },
    enabled: !!batchId,
  });
}

export interface ResolveImportRowInput {
  batchId: string;
  rowId: string;
  action: PopulationImportRowResolutionAction;
  villageId?: string;
  note?: string;
}

// Manual, human-only resolution of a hierarchy_mismatch / region_not_found
// / needs_review row — never automatic. Only valid while the batch is
// still 'ready' (before confirm); see
// VillagePopulationImportService.resolveRow.
export function useResolveImportRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ResolveImportRowInput) => {
      const { data } = await apiClient.patch<VillagePopulationImportRow>(
        `/village-population-imports/${input.batchId}/rows/${input.rowId}/resolve`,
        { action: input.action, villageId: input.villageId, note: input.note },
      );
      return data;
    },
    onSuccess: (_row, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['village-population-import-rows', input.batchId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['village-population-import-batch', input.batchId],
      });
    },
  });
}

export function useConfirmImportBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data } = await apiClient.post<VillagePopulationImportBatch>(
        `/village-population-imports/${batchId}/confirm`,
      );
      return data;
    },
    onSuccess: (batch) => {
      queryClient.setQueryData(['village-population-import-batch', batch.id], batch);
      void queryClient.invalidateQueries({
        queryKey: ['village-population-import-rows', batch.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['village-population'] });
    },
  });
}

export function useRetryImportBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data } = await apiClient.post<VillagePopulationImportBatch>(
        `/village-population-imports/${batchId}/retry`,
      );
      return data;
    },
    onSuccess: (batch) => {
      queryClient.setQueryData(['village-population-import-batch', batch.id], batch);
    },
  });
}

/** Triggers a browser save of the problem-rows CSV — fetched as a blob
 * (auth-header'd via apiClient) rather than a plain `<a href>`, since the
 * endpoint requires a Bearer token a bare link can't carry. */
export async function downloadImportErrorReport(
  batchId: string,
  fileName: string,
): Promise<void> {
  const response = await apiClient.get(`/village-population-imports/${batchId}/error-report.csv`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// A village's own imported population — [] (not an error) when nothing has
// been imported for it yet.
export function useVillagePopulations(villageId: string | undefined) {
  return useQuery({
    queryKey: ['village-population', villageId],
    queryFn: async () => {
      const { data } = await apiClient.get<VillagePopulation[]>(
        `/villages/${villageId}/population`,
      );
      return data;
    },
    enabled: !!villageId,
  });
}

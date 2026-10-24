import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Shelter, ShelterInput, ShelterKind } from '@/types/domain';

// Officer management of posko and titik kumpul. The citizen portal keeps
// using useShelters() (active sites only); every mutation here invalidates
// the shared ['shelters'] prefix so both views refresh.
export function useManagedShelters(filters: { district?: string; kind?: ShelterKind }) {
  return useQuery({
    queryKey: ['shelters', 'managed', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<Shelter[]>('/shelters', {
        params: { district: filters.district, kind: filters.kind, includeInactive: true },
      });
      return data;
    },
  });
}

export function useSaveShelter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ShelterInput }) => {
      const { data } = id
        ? await apiClient.patch<Shelter>(`/shelters/${id}`, input)
        : await apiClient.post<Shelter>('/shelters', input);
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shelters'] }),
  });
}

export function useDeleteShelter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/shelters/${id}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shelters'] }),
  });
}

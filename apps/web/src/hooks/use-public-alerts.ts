import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  CitizenLocation,
  OperatorPublicAlert,
  PublicAlert,
  PublicAlertHazard,
  PublicAlertLevel,
  PublicAlertResponses,
  PublicWeather,
} from '@/lib/citizen/types';
import type { PaginatedResponse } from '@/types/domain';

// Short enough that an open tab picks up a new alarm within half a minute
// even if push is off or undelivered.
const ACTIVE_ALERT_POLL_MS = 30_000;

export function useActiveAlerts(location: CitizenLocation | null) {
  return useQuery({
    queryKey: ['public-alerts', 'active', location?.districtId, location?.subdistrictId, location?.villageId],
    queryFn: async () => {
      const { data } = await apiClient.get<PublicAlert[]>('/public/alerts/active', {
        params: {
          district: location!.districtId,
          subdistrict: location!.subdistrictId ?? undefined,
          village: location!.villageId ?? undefined,
        },
      });
      return data;
    },
    enabled: !!location,
    refetchInterval: ACTIVE_ALERT_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function usePublicAlert(id: string | undefined) {
  return useQuery({
    queryKey: ['public-alerts', id],
    queryFn: async () => {
      const { data } = await apiClient.get<PublicAlert>(`/public/alerts/${id}`);
      return data;
    },
    enabled: !!id,
    refetchInterval: ACTIVE_ALERT_POLL_MS,
  });
}

export function useRespondToAlert() {
  return useMutation({
    mutationFn: async (input: {
      alertId: string;
      deviceId: string;
      status: 'safe' | 'needs_help';
      latitude?: number;
      longitude?: number;
      peopleCount?: number;
      note?: string;
      contactPhone?: string;
    }) => {
      const { alertId, ...body } = input;
      const { data } = await apiClient.post<{ status: string }>(`/public/alerts/${alertId}/responses`, body);
      return data;
    },
  });
}

export function usePublicWeather(districtId: string | undefined) {
  return useQuery({
    queryKey: ['public-weather', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<PublicWeather | null>('/public/weather', {
        params: { district: districtId },
      });
      return data;
    },
    enabled: !!districtId,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });
}

// --- Operator side (workspace) ---------------------------------------------

export interface CreatePublicAlertInput {
  hazard: PublicAlertHazard;
  level: PublicAlertLevel;
  title: string;
  action: string;
  message: string;
  destinationName?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  avoidText?: string;
  sourceLabel: string;
  districtId: string;
  subdistrictId?: string;
  villageId?: string;
  hazardEventId?: string;
  expiresInHours: number;
}

export function useOperatorAlerts(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['public-alerts', 'operator', page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<OperatorPublicAlert>>('/public-alerts', {
        params: { page, limit },
      });
      return data;
    },
    refetchInterval: 15_000,
  });
}

export function useCreatePublicAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePublicAlertInput) => {
      const { data } = await apiClient.post<PublicAlert>('/public-alerts', input);
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['public-alerts'] }),
  });
}

export function useEndPublicAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<PublicAlert>(`/public-alerts/${id}/end`);
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['public-alerts'] }),
  });
}

export function useAlertResponses(id: string | undefined) {
  return useQuery({
    queryKey: ['public-alerts', id, 'responses'],
    queryFn: async () => {
      const { data } = await apiClient.get<PublicAlertResponses>(`/public-alerts/${id}/responses`);
      return data;
    },
    enabled: !!id,
    refetchInterval: 15_000,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Notification } from '@/types/domain';

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ['notifications', { unreadOnly }],
    queryFn: async () => {
      const { data } = await apiClient.get<Notification[]>('/notifications', {
        params: unreadOnly ? { unread: 'true' } : undefined,
      });
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.patch('/notifications/read-all');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

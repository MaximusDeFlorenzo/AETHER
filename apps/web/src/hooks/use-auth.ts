import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { User } from '@/types/domain';

interface LoginPayload {
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export function useLogin() {
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await apiClient.post<LoginResponse>('/auth/login', payload);
      return data;
    },
    onSuccess: (data) => {
      setSession(data.user, data.accessToken, data.refreshToken);
    },
  });
}

export function useLogout() {
  const { refreshToken, clearSession } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => undefined);
      }
    },
    onSuccess: () => {
      clearSession();
      queryClient.clear();
    },
  });
}

export function useMe() {
  const accessToken = useAuthStore((state) => state.accessToken);

  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data } = await apiClient.get<User>('/auth/me');
      return data;
    },
    enabled: !!accessToken,
    retry: false,
  });
}

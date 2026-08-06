import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PaginatedResponse, RoleName, User } from '@/types/domain';

export interface CreateUserInput {
  email: string;
  fullName: string;
  password: string;
  role: RoleName;
}

export interface UpdateUserInput {
  fullName?: string;
  role?: RoleName;
  isActive?: boolean;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<User>>('/users');
      return data;
    },
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['users'] });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (payload: CreateUserInput) => {
      const { data } = await apiClient.post<User>('/users', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateUserInput & { id: string }) => {
      const { data } = await apiClient.patch<User>(`/users/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/users/${id}`);
    },
    onSuccess: invalidate,
  });
}

export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      const { data } = await apiClient.patch<{ message: string }>('/users/me/password', payload);
      return data;
    },
  });
}

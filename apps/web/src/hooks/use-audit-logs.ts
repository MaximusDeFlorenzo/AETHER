import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PaginatedResponse } from '@/types/domain';

export interface AuditLog {
  id: string;
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<AuditLog>>('/audit-logs');
      return data;
    },
  });
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types/domain';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  hasHydrated: boolean;
  setSession: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearSession: () => void;
  setHasHydrated: (value: boolean) => void;
}

// Persisted to localStorage: apps/api returns both tokens in the login/refresh
// response body (no httpOnly cookie), so this is the only place to keep them
// across page reloads — same tradeoff ORION documented. A hardened
// deployment would move refresh-token storage server-side.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hasHydrated: false,
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      clearSession: () => set({ user: null, accessToken: null, refreshToken: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'aether-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

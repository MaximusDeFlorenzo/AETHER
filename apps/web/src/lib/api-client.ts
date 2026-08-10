import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
});

apiClient.interceptors.request.use((config) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh'];

// Single in-flight refresh shared across concurrent 401s, so a burst of
// requests doesn't fire a burst of refresh calls (each would rotate the
// refresh token and invalidate the others).
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${API_URL}/auth/refresh`,
      { refreshToken },
    );
    useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetryableConfig | undefined;
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => config?.url?.includes(path));

    if (error.response?.status === 401 && config && !config._retried && !isAuthEndpoint) {
      config._retried = true;

      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        config.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(config);
      }

      // Clear the stale session and let the route own the consequence:
      // AuthGuard (workspace/admin routes) reacts to accessToken becoming
      // null with its own client-side router.replace('/admin/login'), while
      // public pages like /risk-map just fall back to isAuthed=false and
      // their existing "Sign in to view" placeholders. A hard
      // window.location.href redirect here would tear down the whole
      // document — including the hazard-events WebSocket — every time a
      // public-page visitor's leftover token happened to be stale.
      useAuthStore.getState().clearSession();
    }

    return Promise.reject(error);
  },
);

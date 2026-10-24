import { AxiosError } from 'axios';

/** Retries transient HTTP failures (network errors, 429, 5xx) with
 * exponential backoff. 4xx other than 429 fail immediately — retrying a bad
 * request only burns the provider's rate limit. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 1000,
  }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts - 1) break;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt),
      );
    }
  }
  throw lastError;
}

export function isTransient(error: unknown): boolean {
  const status = (error as AxiosError)?.response?.status;
  if (status === undefined) return true; // network error / timeout
  return status === 429 || status >= 500;
}

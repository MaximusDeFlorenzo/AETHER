import { apiClient } from '@/lib/api-client';
import type { CitizenLocation } from './types';

export type PushSupport =
  | 'supported'
  | 'unsupported'
  /** iPhone/iPad Safari only delivers web push to sites added to the Home Screen. */
  | 'ios-needs-install'
  | 'denied';

export type EnablePushResult = 'enabled' | 'denied' | 'unsupported' | 'server-disabled' | 'failed';

const SERVICE_WORKER_URL = '/sw.js';

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as Macintosh; touch support tells it apart.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function getPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  if (!hasApis) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
  } catch {
    return null;
  }
}

async function sendSubscription(subscription: PushSubscription, location: CitizenLocation) {
  const json = subscription.toJSON();
  await apiClient.post('/public/push/subscriptions', {
    endpoint: json.endpoint,
    keys: json.keys,
    expirationTime: json.expirationTime ?? null,
    districtId: location.districtId,
    subdistrictId: location.subdistrictId ?? undefined,
    villageId: location.villageId ?? undefined,
  });
}

/**
 * Asks for notification permission (must be called from a click), creates
 * or reuses this browser's push subscription, and files it under the
 * citizen's area. Safe to call again after the area changes.
 */
export async function enableAlarmPush(location: CitizenLocation): Promise<EnablePushResult> {
  const support = getPushSupport();
  if (support === 'unsupported' || support === 'ios-needs-install') return 'unsupported';
  if (support === 'denied') return 'denied';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await registerServiceWorker();
  if (!registration) return 'failed';

  try {
    const { data } = await apiClient.get<{ publicKey: string | null }>('/public/push/public-key');
    if (!data.publicKey) return 'server-disabled';

    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      }));
    await sendSubscription(subscription, location);
    return 'enabled';
  } catch {
    return 'failed';
  }
}

/** Re-files an existing subscription under a new area; no-op if none. */
export async function updateAlarmPushArea(location: CitizenLocation): Promise<void> {
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await sendSubscription(subscription, location);
}

export async function disableAlarmPush(): Promise<void> {
  const registration = await registerServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await apiClient.delete('/public/push/subscriptions', { data: { endpoint: subscription.endpoint } });
  } finally {
    await subscription.unsubscribe();
  }
}

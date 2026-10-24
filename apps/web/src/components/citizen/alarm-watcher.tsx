'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useActiveAlerts } from '@/hooks/use-public-alerts';
import { registerServiceWorker, updateAlarmPushArea } from '@/lib/citizen/push';
import { useCitizenStore } from '@/stores/citizen-store';
import { AlarmOverlay } from './alarm-overlay';

/**
 * Keeps an open portal tab listening for alarms for the citizen's area:
 * polls /public/alerts/active (useActiveAlerts), and refetches immediately
 * when the service worker relays a push. The first unanswered active alarm
 * takes over the screen. Mounted once in CitizenShell.
 */
export function AlarmWatcher() {
  const pathname = usePathname();
  const location = useCitizenStore((state) => state.location);
  const handled = useCitizenStore((state) => state.handledAlertIds);
  const pushEnabled = useCitizenStore((state) => state.pushEnabled);
  const hasHydrated = useCitizenStore((state) => state.hasHydrated);
  const { data, refetch } = useActiveAlerts(location);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'aether-alert') void refetch();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [refetch]);

  // Keep the worker registered (it may have been cleared) and keep the
  // server's copy of the citizen's area in sync when they move it.
  useEffect(() => {
    if (!hasHydrated || !pushEnabled || !location) return;
    void registerServiceWorker().then(() => updateAlarmPushArea(location).catch(() => undefined));
  }, [hasHydrated, pushEnabled, location]);

  // The dedicated alarm page renders its own screen.
  if (pathname.startsWith('/peringatan')) return null;

  const alert = data?.find((candidate) => candidate.isActive && !handled.includes(candidate.id));
  if (!alert) return null;
  return <AlarmOverlay key={alert.id} alert={alert} variant="overlay" />;
}

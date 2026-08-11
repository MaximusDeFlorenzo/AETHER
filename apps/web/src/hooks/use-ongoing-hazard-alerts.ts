'use client';

import { useEffect } from 'react';
import { useHazardEvents } from './use-hazard-events';
import { useHazardAlertStore } from '@/stores/hazard-alert-store';
import { isOngoingHighSeverityHazardEvent } from '@/lib/hazard-severity';

// Re-surfaces the evacuation alert for hazards that are still ongoing, not
// only at the moment they're first detected (that trigger is the
// hazard_event.created socket handler in use-realtime-sync). Rides on
// useHazardEvents' existing 60s poll — each refetch, every high-severity
// event still inside the ongoing window gets pushed again; the store's
// snooze bookkeeping is what stops that from re-popping the dialog on every
// single poll tick. Mounted once in WorkspaceShell, alongside useRealtimeSync.
export function useOngoingHazardAlerts() {
  const { data } = useHazardEvents({ limit: 50 });

  useEffect(() => {
    if (!data) return;
    for (const event of data.data) {
      if (isOngoingHighSeverityHazardEvent(event)) {
        useHazardAlertStore.getState().pushAlert(event, 'ongoing');
      }
    }
  }, [data]);
}

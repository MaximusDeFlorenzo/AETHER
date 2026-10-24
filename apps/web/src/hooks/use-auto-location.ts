import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { locationSummary } from '@/lib/citizen/geo';
import { detectLocation, geolocationPermission, sameArea } from '@/lib/citizen/locate';
import { useCitizenStore } from '@/stores/citizen-store';

// Often enough to follow someone driving between kabupaten, rare enough not
// to drain a phone battery or hammer the reverse-geocoder.
const RECHECK_MS = 5 * 60 * 1000;

/**
 * While the portal is open and the citizen opted into "ikuti lokasi saya",
 * re-detects their area on open, every 5 minutes, and whenever the tab
 * comes back into view. Browsers don't allow a website to read location in
 * the background, so with the site closed alarms go to the last detected
 * area (the push subscription is re-filed by AlarmWatcher on each change).
 */
export function useAutoLocation(enabled: boolean) {
  const autoLocate = useCitizenStore((state) => state.autoLocate);
  const hasHydrated = useCitizenStore((state) => state.hasHydrated);
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !hasHydrated || !autoLocate) return;

    const check = async () => {
      if (running.current || document.visibilityState !== 'visible') return;
      // Never surprise the citizen with a permission prompt from a timer —
      // only re-check silently once permission is already granted (or the
      // browser can't tell us, in which case it won't re-prompt anyway).
      const permission = await geolocationPermission();
      if (permission === 'denied') {
        useCitizenStore.getState().setAutoLocate(false);
        toast.info('Izin lokasi dimatikan, jadi wilayah tidak lagi diperbarui otomatis.');
        return;
      }
      if (permission === 'prompt') return;

      running.current = true;
      try {
        const result = await detectLocation();
        if (!result.ok) return;
        const { location, markLocated, setLocation } = useCitizenStore.getState();
        markLocated();
        if (!sameArea(location, result.location)) {
          setLocation(result.location);
          if (location) toast.success(`Lokasi diperbarui: ${locationSummary(result.location)}`);
        }
      } finally {
        running.current = false;
      }
    };

    void check();
    const timer = window.setInterval(check, RECHECK_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, hasHydrated, autoLocate]);
}

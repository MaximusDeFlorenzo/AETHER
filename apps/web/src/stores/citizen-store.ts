import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CitizenLocation, WatchedLocation } from '@/lib/citizen/types';

const MAX_WATCHED = 5;

function newDeviceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

interface CitizenState {
  location: CitizenLocation | null;
  watched: WatchedLocation[];
  /** Anonymous per-browser id so "Saya aman" answers overwrite instead of stacking. */
  deviceId: string;
  pushEnabled: boolean;
  /** Alarms the citizen has already answered or closed — not re-shown. */
  handledAlertIds: string[];
  /** Checklist ticks keyed by `${guide}-${level}`. */
  checklist: Record<string, boolean[]>;
  /** Keep the area in sync with GPS while the portal is open. */
  autoLocate: boolean;
  lastLocatedAt: number | null;
  /** The intro was skipped or finished — don't auto-play it on later visits. */
  introSeen: boolean;
  hasHydrated: boolean;
  setLocation: (location: CitizenLocation) => void;
  setAutoLocate: (enabled: boolean) => void;
  markLocated: () => void;
  clearLocation: () => void;
  addWatched: (location: WatchedLocation) => void;
  removeWatched: (districtId: string, villageId: string | null) => void;
  updateWatched: (
    districtId: string,
    villageId: string | null,
    patch: Partial<Pick<WatchedLocation, 'label' | 'phone' | 'email'>>,
  ) => void;
  setPushEnabled: (enabled: boolean) => void;
  markAlertHandled: (alertId: string) => void;
  toggleChecklist: (key: string, index: number, size: number) => void;
  markIntroSeen: () => void;
  setHasHydrated: (value: boolean) => void;
}

// Everything here stays in the citizen's own browser — no account, and the
// server only ever learns the area (via the push subscription) if the
// citizen turns alarms on.
export const useCitizenStore = create<CitizenState>()(
  persist(
    (set) => ({
      location: null,
      watched: [],
      deviceId: newDeviceId(),
      pushEnabled: false,
      handledAlertIds: [],
      checklist: {},
      autoLocate: false,
      lastLocatedAt: null,
      introSeen: false,
      hasHydrated: false,
      setLocation: (location) => set({ location }),
      setAutoLocate: (autoLocate) => set({ autoLocate }),
      markLocated: () => set({ lastLocatedAt: Date.now() }),
      clearLocation: () => set({ location: null, pushEnabled: false, autoLocate: false }),
      addWatched: (location) =>
        set((state) => ({
          watched: [
            ...state.watched.filter(
              (item) => !(item.districtId === location.districtId && item.villageId === location.villageId),
            ),
            location,
          ].slice(-MAX_WATCHED),
        })),
      removeWatched: (districtId, villageId) =>
        set((state) => ({
          watched: state.watched.filter(
            (item) => !(item.districtId === districtId && item.villageId === villageId),
          ),
        })),
      updateWatched: (districtId, villageId, patch) =>
        set((state) => ({
          watched: state.watched.map((item) =>
            item.districtId === districtId && item.villageId === villageId ? { ...item, ...patch } : item,
          ),
        })),
      setPushEnabled: (pushEnabled) => set({ pushEnabled }),
      markAlertHandled: (alertId) =>
        set((state) => ({
          handledAlertIds: state.handledAlertIds.includes(alertId)
            ? state.handledAlertIds
            : [...state.handledAlertIds, alertId].slice(-100),
        })),
      toggleChecklist: (key, index, size) =>
        set((state) => {
          const current = state.checklist[key] ?? Array<boolean>(size).fill(false);
          const next = current.slice(0, size);
          while (next.length < size) next.push(false);
          next[index] = !next[index];
          return { checklist: { ...state.checklist, [key]: next } };
        }),
      markIntroSeen: () => set({ introSeen: true }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'aether-citizen',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        location: state.location,
        watched: state.watched,
        deviceId: state.deviceId,
        pushEnabled: state.pushEnabled,
        handledAlertIds: state.handledAlertIds,
        checklist: state.checklist,
        autoLocate: state.autoLocate,
        lastLocatedAt: state.lastLocatedAt,
        introSeen: state.introSeen,
      }),
    },
  ),
);

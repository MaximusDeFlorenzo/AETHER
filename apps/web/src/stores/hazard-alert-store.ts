import { create } from 'zustand';
import type { HazardEvent } from '@/types/domain';

interface HazardAlertState {
  queue: HazardEvent[];
  pushAlert: (event: HazardEvent) => void;
  dismissCurrent: () => void;
}

// Queue (not a single slot) so a burst of high-severity events during a
// fast-moving disaster each still get their own evacuation popup rather than
// silently overwriting one another — the analyst dismisses/reviews them one
// at a time. Read by EvacuationAlertDialog, pushed to from use-realtime-sync.
export const useHazardAlertStore = create<HazardAlertState>((set) => ({
  queue: [],
  pushAlert: (event) =>
    set((state) => (state.queue.some((e) => e.id === event.id) ? state : { queue: [...state.queue, event] })),
  dismissCurrent: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

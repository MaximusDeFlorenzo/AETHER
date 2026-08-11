import { create } from 'zustand';
import { playAlertSound, type AlertSoundKind } from '@/lib/alert-sound';
import type { HazardEvent } from '@/types/domain';

// A dismissed-but-still-ongoing hazard (per useOngoingHazardAlerts' recency
// check) re-queues after this long rather than immediately — dismissing
// means "not right now", not "never show me this again", but it shouldn't
// nag on every 60s poll either.
const SNOOZE_INTERVAL_MS = 10 * 60 * 1000;

interface HazardAlertState {
  queue: HazardEvent[];
  lastShownAt: Record<string, number>;
  pushAlert: (event: HazardEvent, soundKind?: AlertSoundKind) => void;
  dismissCurrent: () => void;
}

// Queue (not a single slot) so a burst of high-severity events during a
// fast-moving disaster each still get their own evacuation popup rather than
// silently overwriting one another — the analyst dismisses/reviews them one
// at a time. Read by EvacuationAlertDialog, pushed to from both
// use-realtime-sync (on first detection) and useOngoingHazardAlerts (while
// still ongoing) — the snooze bookkeeping here is what lets both call the
// same pushAlert without double-popping. playAlertSound() is fired from
// here, not by each caller, so every path that actually queues an alert
// (including a page refresh landing straight on an ongoing hazard, with no
// hazard_event.created socket message involved) reliably gets the sound too.
export const useHazardAlertStore = create<HazardAlertState>((set) => ({
  queue: [],
  lastShownAt: {},
  pushAlert: (event, soundKind = 'new') =>
    set((state) => {
      if (state.queue.some((e) => e.id === event.id)) return state;
      const shownAt = state.lastShownAt[event.id];
      if (shownAt != null && Date.now() - shownAt < SNOOZE_INTERVAL_MS) return state;
      playAlertSound(soundKind);
      return {
        queue: [...state.queue, event],
        lastShownAt: { ...state.lastShownAt, [event.id]: Date.now() },
      };
    }),
  dismissCurrent: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

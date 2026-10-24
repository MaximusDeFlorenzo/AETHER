'use client';

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { useHazardAlertStore } from '@/stores/hazard-alert-store';
import { formatHazardEventLocation } from '@/lib/hazard-severity';
import { getHazardDetailMetrics } from '@/lib/hazard-metrics';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';

// Full-screen popup for high-severity hazard events (the same threshold
// use-realtime-sync uses to decide whether to play the alert chime) — the
// toast alone is easy to miss, so events severe enough to warrant possible
// evacuation get an interrupting modal with the key detail fields. Fires on
// first detection (use-realtime-sync) AND keeps re-firing periodically while
// the hazard is still ongoing (useOngoingHazardAlerts), snooze-gated by
// useHazardAlertStore so dismissing means "not right now" rather than
// "never show me this again". Mounted once in WorkspaceShell; state lives in
// useHazardAlertStore so any caller can enqueue an alert without
// prop-drilling.
export function EvacuationAlertDialog() {
  const router = useRouter();
  const event = useHazardAlertStore((state) => state.queue[0] ?? null);
  const queueLength = useHazardAlertStore((state) => state.queue.length);
  const dismissCurrent = useHazardAlertStore((state) => state.dismissCurrent);
  const dismissAll = useHazardAlertStore((state) => state.dismissAll);

  return (
    <Dialog open={event != null} onOpenChange={(open) => !open && dismissCurrent()}>
      {event && (
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-danger">Evacuation Alert</DialogTitle>
                <DialogDescription>
                  High-severity {HAZARD_TYPE_LABELS[event.hazardType].toLowerCase()} ongoing — review immediately
                  and follow local evacuation guidance.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <HazardTypeBadge hazardType={event.hazardType} />
              <span className="text-sm font-medium">{formatHazardEventLocation(event)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')}</p>
            <div className="grid grid-cols-2 gap-2">
              {getHazardDetailMetrics(event.hazardType, event.details).map((metric) => (
                <div key={metric.label} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <metric.icon className="h-3.5 w-3.5" />
                    {metric.label}
                  </div>
                  <p className="mt-1 text-base font-semibold tabular-nums">{metric.value}</p>
                </div>
              ))}
            </div>
            {queueLength > 1 && (
              <p className="text-xs text-muted-foreground">+{queueLength - 1} more alert(s) pending</p>
            )}
          </div>

          <DialogFooter>
            {queueLength > 1 && (
              <Button variant="ghost" onClick={dismissAll}>
                Dismiss all ({queueLength})
              </Button>
            )}
            <Button variant="outline" onClick={dismissCurrent}>
              Dismiss
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                dismissCurrent();
                router.push(`/hazards/${event.id}`);
              }}
            >
              View evacuation details
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

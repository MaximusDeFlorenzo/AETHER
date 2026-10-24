'use client';

import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { KarhutlaForecast } from '@/types/karhutla';
import { FRESHNESS_LABEL, FRESHNESS_STYLES, exposedPlacesAt } from './karhutla-utils';

interface KarhutlaClusterListProps {
  forecasts: KarhutlaForecast[];
  horizonHours: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function KarhutlaClusterList({ forecasts, horizonHours, selectedId, onSelect }: KarhutlaClusterListProps) {
  if (!forecasts.length) {
    return <p className="p-3 text-sm text-muted-foreground">No eligible hotspot clusters in this run.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {forecasts.map((f) => {
        const exposed = exposedPlacesAt([f], horizonHours).length;
        const active = f.id === selectedId;
        const fresh = f.dataQuality.hotspotFreshness;
        return (
          <li key={f.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? null : f.id)}
              className={cn(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">#{f.rank}</span>
                    {f.location.label ?? 'Unlabelled location'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    latest detection {formatDistanceToNow(new Date(f.observed.latestObservedAt), { addSuffix: true })}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                    FRESHNESS_STYLES[fresh],
                  )}
                >
                  {FRESHNESS_LABEL[fresh]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <strong className="font-semibold text-foreground tabular-nums">{f.observed.hotspotCount}</strong> hotspots
                </span>
                {f.observed.totalFrpMw != null && (
                  <span>
                    <strong className="font-semibold text-foreground tabular-nums">
                      {Math.round(f.observed.totalFrpMw).toLocaleString()}
                    </strong>{' '}
                    MW FRP
                  </span>
                )}
                <span>
                  <strong className={cn('font-semibold tabular-nums', exposed ? 'text-warning' : 'text-foreground')}>
                    {exposed}
                  </strong>{' '}
                  places at +{horizonHours} h
                </span>
                {f.status !== 'ok' && <span className="text-danger">{f.status.replace('_', ' ')}</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowRight, Loader2, Waves } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAffectedRegions, useHazardEventRelationships } from '@/hooks/use-hazard-events';
import {
  DEPTH_LABEL,
  type EarthquakeEvent,
  MAGNITUDE_LABEL,
  depthClass,
  formatMagnitude,
  isSimulated,
  magnitudeClass,
  magnitudeColor,
} from './earthquake-utils';

// Affected regions are resolved server-side by distance from the epicentre;
// the nearest few are what an operator acts on first.
const NEAREST_REGIONS = 8;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One earthquake: parameters, nearest districts and linked hazards. */
export function EarthquakeDetailPanel({ event }: { event: EarthquakeEvent }) {
  const { magnitude, depthKm, potentialTsunami } = event.details;
  const regions = useAffectedRegions(event.id);
  const relationships = useHazardEventRelationships(event.id);
  const nearest = [...(regions.data ?? [])].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, NEAREST_REGIONS);

  return (
    <Card className="gap-0 py-0">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{event.locationLabel ?? event.region ?? 'Unnamed location'}</h2>
            <p className="text-xs text-muted-foreground">
              {format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')} (
              {formatDistanceToNow(new Date(event.eventTime), { addSuffix: true })})
            </p>
          </div>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums"
            style={{ background: magnitudeColor(magnitude) }}
          >
            {formatMagnitude(magnitude)}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {potentialTsunami && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
            <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
            <span>
              <strong className="font-semibold">BMKG flagged tsunami potential.</strong> Follow official BMKG/BPBD
              instructions for coastal areas.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Magnitude" value={formatMagnitude(magnitude)} hint={MAGNITUDE_LABEL[magnitudeClass(magnitude)]} />
          <Stat label="Depth" value={`${depthKm} km`} hint={DEPTH_LABEL[depthClass(depthKm)]} />
          <Stat
            label="Epicentre"
            value={`${event.latitude.toFixed(2)}, ${event.longitude.toFixed(2)}`}
            hint={event.region && event.region !== event.locationLabel ? event.region : undefined}
          />
          <Stat
            label="Source"
            value={isSimulated(event) ? 'Simulation' : event.source === 'bmkg_gempaterkini' ? 'BMKG' : event.source}
            hint={isSimulated(event) ? 'not a real event' : undefined}
          />
        </div>

        <div>
          <SectionLabel>Nearest districts</SectionLabel>
          {regions.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : nearest.length ? (
            <ul className="space-y-1 text-xs">
              {nearest.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {r.district.name}
                    {r.district.province && (
                      <span className="text-muted-foreground">, {r.district.province.name}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{r.distanceKm.toFixed(0)} km</span>
                </li>
              ))}
              {(regions.data?.length ?? 0) > NEAREST_REGIONS && (
                <li className="text-muted-foreground">+{(regions.data?.length ?? 0) - NEAREST_REGIONS} more within range</li>
              )}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No district resolved within range.</p>
          )}
        </div>

        {relationships.data && relationships.data.length > 0 && (
          <div>
            <SectionLabel>Linked hazards</SectionLabel>
            <ul className="space-y-1.5 text-xs">
              {relationships.data.map((rel) => (
                <li key={rel.id} className="rounded-lg bg-muted/50 p-2">
                  <span className="font-medium">{rel.relationshipType.replaceAll('_', ' ')}</span>
                  <span className="text-muted-foreground"> · {rel.relatedHazardEvent.hazardType}</span>
                  <p className="text-muted-foreground">{rel.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link
          href={`/hazards/${event.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Full event detail <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Card>
  );
}

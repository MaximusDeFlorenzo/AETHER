'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardMap } from '@/components/map/map-loader';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { useSpatialOverlay } from '@/hooks/use-spatial-overlay';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { SpatialOverlayLayer } from '@/types/domain';

const OVERLAY_OPTIONS: { value: SpatialOverlayLayer | 'none'; label: string }[] = [
  { value: 'none', label: 'No overlay' },
  { value: 'risk', label: 'Risk zones' },
  { value: 'vulnerability', label: 'Vulnerability zones' },
  { value: 'exposure', label: 'Exposure zones' },
];

// The Phase 1 multi-hazard map — generalizes ORION's earthquake-only
// dashboard map: earthquake + landslide markers, hazard-type filter chips
// (drawn inside HazardMap), and a GeoJSON polygon overlay toggle
// (risk/vulnerability/exposure) that ORION never had (docs/API_SPEC.md §6).
export default function RiskMapPage() {
  const router = useRouter();
  const [overlayLayer, setOverlayLayer] = useState<SpatialOverlayLayer | 'none'>('risk');

  const { data, isLoading } = useHazardEvents({ limit: 200 });
  const events = useMemo(() => data?.data ?? [], [data]);

  const { data: overlay } = useSpatialOverlay(
    { layer: overlayLayer === 'none' ? 'risk' : overlayLayer },
    overlayLayer !== 'none',
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Multi-Hazard Risk Map</h1>
          <p className="text-sm text-muted-foreground">
            Live earthquake and landslide events across Indonesia — {data?.meta.total ?? 0} events
            tracked.
          </p>
        </div>
        <div className="w-56 space-y-1.5">
          <Label>Spatial overlay layer</Label>
          <Select
            value={overlayLayer}
            onValueChange={(v) => setOverlayLayer((v as SpatialOverlayLayer | 'none') ?? 'none')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OVERLAY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> Indonesia — Interactive Hazard Map
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[480px] sm:h-[560px] lg:h-[640px]">
          {isLoading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : (
            <HazardMap
              events={events}
              overlay={overlayLayer === 'none' ? null : overlay}
              overlayLabel={
                overlayLayer === 'none'
                  ? 'Overlay'
                  : OVERLAY_OPTIONS.find((o) => o.value === overlayLayer)?.label
              }
              onSelect={(id) => router.push(`/hazards/${id}`)}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(['earthquake', 'landslide', 'flood', 'wildfire'] as const).map((type) => (
          <Card key={type}>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-muted-foreground">{HAZARD_TYPE_LABELS[type]}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {events.filter((e) => e.hazardType === type).length}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

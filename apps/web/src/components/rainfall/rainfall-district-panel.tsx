'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useRainfallDistrictOutlook } from '@/hooks/use-rainfall-outlook';
import { cn } from '@/lib/utils';
import type { DistrictOutlook, FloodOutlook, LandslideOutlook, RainfallRecommendation } from '@/types/rainfall';
import { SEVERITY_LABEL, compass, formatPopulation, severityColor } from './rainfall-utils';

const PRIORITY_STYLES: Record<RainfallRecommendation['priority'], string> = {
  priority: 'border-danger/30 bg-danger/5',
  advisory: 'border-warning/30 bg-warning/5',
  info: 'border-border bg-muted/40',
};

const TERRAIN_LABEL: Record<LandslideOutlook['terrainClass'], string> = {
  low: 'gentle (< 20 %)',
  medium: 'moderate (20–40 %)',
  high: 'steep (> 40 %)',
  unknown: 'not yet sampled',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</p>;
}

function LevelPill({ level }: { level: DistrictOutlook['severity'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: severityColor(level) }} aria-hidden />
      {level ?? '—'}
    </span>
  );
}

function HazardBlock({
  title,
  summary,
  extra,
}: {
  title: string;
  summary: FloodOutlook | LandslideOutlook | null;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        {summary?.status === 'ok' ? (
          <LevelPill level={summary.level} />
        ) : (
          <span className="text-muted-foreground">{summary ? 'insufficient data' : 'no run'}</span>
        )}
      </div>
      {summary && (
        <div className="space-y-0.5 text-muted-foreground">
          <p>
            Confidence: <span className="text-foreground">{summary.confidence.replace('_', ' ')}</span>
          </p>
          {summary.raisedBy.length > 0 && <p>Raised by: {summary.raisedBy.join('; ')}</p>}
          {extra}
          {summary.confidenceReasons && summary.confidenceReasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {summary.confidenceReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One district: levels, rain, exposure and the rule-based recommendations
 * (fetched per district — the list view is compact). */
export function RainfallDistrictPanel({ summary }: { summary: DistrictOutlook }) {
  const { data: detail, isLoading } = useRainfallDistrictOutlook(summary.districtId);
  const [lang, setLang] = useState<'en' | 'id'>('en');
  const d = detail ?? summary;
  const rain = d.rain;
  const movement = rain?.movement;

  return (
    <Card className="gap-0 py-0">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{d.districtName}</h2>
            <p className="truncate text-xs text-muted-foreground">{d.provinceName ?? ''}</p>
          </div>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ background: severityColor(d.severity) }}
          >
            {d.severity ? SEVERITY_LABEL[d.severity] : 'No level'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">Rain now (satellite)</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {rain?.currentMmPerHour != null ? `${rain.currentMmPerHour.toFixed(1)} mm/h` : '—'}
            </p>
            {rain && (
              <p className={cn('mt-0.5 text-[11px]', rain.freshness === 'fresh' ? 'text-muted-foreground' : 'text-warning')}>
                {rain.freshness}
                {rain.dataValidTime && ` · ${format(new Date(rain.dataValidTime), 'dd MMM HH:mm')}`}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">Rain ≥ 1 mm/h in +1 h</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {rain?.nextHourProbability != null ? `${Math.round(rain.nextHourProbability * 100)} %` : '—'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {rain?.method ? `${rain.method.replace(/_/g, ' ')}${rain.calibrated ? '' : ' · uncalibrated'}` : ''}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">Rain movement</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {movement?.towardDeg != null
                ? `→ ${compass(movement.towardDeg)}${movement.speedKmh != null ? ` ${Math.round(movement.speedKmh)} km/h` : ''}`
                : '—'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {movement ? `${movement.status.replace(/_/g, ' ')}${movement.confidence ? ` · ${movement.confidence}` : ''}` : ''}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">Population (context)</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {d.exposure ? formatPopulation(d.exposure.population) : '—'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {d.exposure ? `${Math.round(d.exposure.densityPerKm2)}/km² · ${d.exposure.year}` : 'no statistic'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <SectionLabel>Hazard levels (rule-based)</SectionLabel>
          <HazardBlock
            title="Flood"
            summary={d.flood}
            extra={d.flood?.gauge && <p>Official gauge: {d.flood.gauge.name} — {d.flood.gauge.label}</p>}
          />
          <HazardBlock
            title="Landslide"
            summary={d.landslide}
            extra={d.landslide && <p>Terrain (DEM slope p90): {TERRAIN_LABEL[d.landslide.terrainClass]}</p>}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Recommendations</SectionLabel>
            <div role="radiogroup" aria-label="Language" className="mb-2 flex rounded-md border border-border p-0.5">
              {(['en', 'id'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => setLang(l)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] font-medium uppercase',
                    lang === l ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {isLoading && !detail ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : detail?.recommendations ? (
            detail.recommendations.map((r) => (
              <div key={r.code} className={cn('rounded-lg border p-2.5 text-xs', PRIORITY_STYLES[r.priority])}>
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {r.priority} · for {r.audience}
                </p>
                <p className="text-foreground">{lang === 'id' ? r.textId : r.text}</p>
                <p className="mt-1 text-muted-foreground">Basis: {r.basis}</p>
              </div>
            ))
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not load recommendations.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CloudRain, Clock, Mountain, Waves } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KpiRow, type Kpi } from '@/components/dashboard/kpi-row';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { RainfallOutlookMap } from '@/components/rainfall/rainfall-outlook-map-loader';
import { RainfallDistrictPanel } from '@/components/rainfall/rainfall-district-panel';
import {
  SEVERITIES,
  SEVERITY_LABEL,
  atLeast,
  formatPopulation,
  severityColor,
} from '@/components/rainfall/rainfall-utils';
import { useRainfallOutlook } from '@/hooks/use-rainfall-outlook';
import { cn } from '@/lib/utils';
import type { DistrictOutlook, OutlookRunRef, RainfallOutlook, RainfallSeverity } from '@/types/rainfall';

const dt = (iso: string) => format(new Date(iso), 'dd MMM yyyy HH:mm');

function outlookKpis(outlook: RainfallOutlook): Kpi[] {
  const ds = outlook.districts;
  const raised = ds.filter((d) => atLeast(d, 'MEDIUM')).length;
  const flood = ds.filter((d) => d.flood?.level && d.flood.level !== 'LOW').length;
  const landslide = ds.filter((d) => d.landslide?.level && d.landslide.level !== 'LOW').length;
  const withRain = ds.filter((d) => d.rain);
  const fresh = withRain.filter((d) => d.rain?.freshness === 'fresh').length;
  return [
    {
      label: 'Districts at Medium+',
      value: String(raised),
      hint: `of ${ds.length} · ${ds.filter((d) => d.severity === null).length} without a level`,
      icon: CloudRain,
      tone: raised > 0 ? 'warning' : 'primary',
    },
    { label: 'Flood Medium+', value: String(flood), hint: 'BMKG rain categories + InaRISK + gauges', icon: Waves, tone: 'info' },
    {
      label: 'Landslide Medium+',
      value: String(landslide),
      hint: 'rain intensity–duration curves × DEM slope',
      icon: Mountain,
      tone: 'warning',
    },
    {
      label: 'Fresh rain fields',
      value: `${fresh}/${withRain.length}`,
      hint: 'GSMaP satellite, updated hourly',
      icon: Clock,
      tone: fresh === withRain.length ? 'success' : 'warning',
    },
  ];
}

function SourceLine({ label, run }: { label: string; run: OutlookRunRef | null }) {
  return (
    <li>
      {label}:{' '}
      {run ? (
        <>
          issued {dt(run.issuedAt)} ({formatDistanceToNow(new Date(run.issuedAt), { addSuffix: true })})
          {run.dataValidTime && ` · rain valid ${dt(run.dataValidTime)}`}
        </>
      ) : (
        'no completed run'
      )}
    </li>
  );
}

function DistrictRow({
  d,
  selected,
  onSelect,
}: {
  d: DistrictOutlook;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(d.districtId)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
          selected ? 'bg-primary/10' : 'hover:bg-muted/60',
        )}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: severityColor(d.severity) }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{d.districtName}</span>
          <span className="block truncate text-muted-foreground">
            flood {d.flood?.level ?? '—'} · landslide {d.landslide?.level ?? '—'}
            {d.recommendationCodes.includes('MORE_RAIN_INDICATED') && ' · more rain indicated'}
          </span>
        </span>
        {d.exposure && (
          <span className="shrink-0 text-muted-foreground tabular-nums">{formatPopulation(d.exposure.population)}</span>
        )}
      </button>
    </li>
  );
}

export default function RainfallOutlookPage() {
  const { data, isLoading, isError } = useRainfallOutlook();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minSeverity, setMinSeverity] = useState<RainfallSeverity>('MEDIUM');
  const [query, setQuery] = useState('');
  const districts = useMemo(() => data?.districts ?? [], [data]);

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return districts.filter((d) =>
      q
        ? d.districtName.toLowerCase().includes(q) || (d.provinceName ?? '').toLowerCase().includes(q)
        : atLeast(d, minSeverity),
    );
  }, [districts, minSeverity, query]);
  const selected = districts.find((d) => d.districtId === selectedId) ?? listed[0] ?? null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={CloudRain}
        eyebrow="Experimental"
        title="Rainfall Outlook"
        description="Flood and landslide levels per district from satellite rainfall and rule-based thresholds, with grounded recommendations."
      >
        {data && (
          <p className="text-xs text-muted-foreground">
            Generated {dt(data.generatedAt)} · rules {data.rulesVersion}
          </p>
        )}
      </PageHeader>

      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          <strong className="font-semibold">Decision support only — verify before acting.</strong>{' '}
          {data?.disclaimer ??
            'Levels come from experimental, uncalibrated rules; they are not BMKG or BNPB warnings and never an evacuation order.'}
        </span>
      </p>

      {isError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load the rainfall outlook</AlertTitle>
        </Alert>
      )}

      {data && data.missing.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Inputs missing</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {data.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-5">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-[560px] w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          <KpiRow kpis={outlookKpis(data)} />

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="gap-0 overflow-hidden py-0">
              <div className="h-[460px] sm:h-[560px]">
                <RainfallOutlookMap districts={districts} selectedId={selected?.districtId ?? null} onSelect={setSelectedId} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-xs">
                {SEVERITIES.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: severityColor(s) }} aria-hidden />
                    {SEVERITY_LABEL[s]}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: severityColor(null) }} aria-hidden />
                  No level issued
                </span>
                <span className="text-muted-foreground">Higher of flood and landslide · district reference points</span>
              </div>
            </Card>

            <div className="space-y-5">
              <Card className="gap-0 py-0">
                <div className="space-y-2 border-b border-border px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold">Districts</h2>
                    <span className="text-xs text-muted-foreground">by level, then population</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search district or province"
                      className="h-8 text-xs"
                    />
                    <div role="radiogroup" aria-label="Minimum level" className="flex shrink-0 rounded-md border border-border p-0.5">
                      {(['LOW', 'MEDIUM', 'HIGH'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={minSeverity === s}
                          disabled={Boolean(query)}
                          onClick={() => setMinSeverity(s)}
                          className={cn(
                            'rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-50',
                            minSeverity === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {s === 'LOW' ? 'All' : `${SEVERITY_LABEL[s]}+`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <ul className="max-h-[340px] overflow-y-auto p-2">
                  {listed.length ? (
                    listed.map((d) => (
                      <DistrictRow
                        key={d.districtId}
                        d={d}
                        selected={d.districtId === selected?.districtId}
                        onSelect={setSelectedId}
                      />
                    ))
                  ) : (
                    <li className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                      {query ? 'No district matches.' : 'No district at this level.'}
                    </li>
                  )}
                </ul>
              </Card>
              {selected && <RainfallDistrictPanel key={selected.districtId} summary={selected} />}
            </div>
          </div>

          <Card>
            <CardContent className="space-y-2 py-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Sources</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <SourceLine label="Rain nowcast" run={data.sources.nowcast} />
                <SourceLine label="Flood risk" run={data.sources.flood} />
                <SourceLine label="Landslide risk" run={data.sources.landslide} />
                <li>Population: {data.sources.population}</li>
              </ul>
              <p>{data.affectedAreaNote}</p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Flame, Loader2, MapPin, Play, Satellite } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiRow, type Kpi } from '@/components/dashboard/kpi-row';
import { Skeleton } from '@/components/ui/skeleton';
import { KarhutlaMap } from '@/components/karhutla/karhutla-map-loader';
import { KarhutlaDetailPanel } from '@/components/karhutla/karhutla-detail-panel';
import { KarhutlaClusterList } from '@/components/karhutla/karhutla-cluster-list';
import { KarhutlaLegend } from '@/components/karhutla/karhutla-legend';
import { KarhutlaSourceHealth } from '@/components/karhutla/karhutla-source-health';
import { KarhutlaSpreadInset } from '@/components/karhutla/karhutla-spread-inset';
import { KarhutlaTimeline } from '@/components/karhutla/karhutla-timeline';
import { exposedPlacesAt } from '@/components/karhutla/karhutla-utils';
import { useKarhutlaLatest, useKarhutlaVerification, useRequestKarhutlaRun } from '@/hooks/use-karhutla';
import { useAuthStore } from '@/stores/auth-store';
import type { KarhutlaForecast, KarhutlaRun } from '@/types/karhutla';
import { PageHeader } from '@/components/shared/page-header';

// A run older than this is shown as outdated — FIRMS' polar orbiters (MODIS +
// VIIRS) leave multi-hour gaps and scheduled runs default to every 3 h.
const OUTDATED_AFTER_HOURS = 6;

const dt = (iso: string) => format(new Date(iso), 'dd MMM yyyy HH:mm');

const STATUS_DOT: Record<KarhutlaRun['status'], string> = {
  completed: 'bg-success',
  partial: 'bg-warning',
  failed: 'bg-danger',
  queued: 'bg-info',
  running: 'bg-info',
};

function RunStatusLine({ run }: { run: KarhutlaRun }) {
  const seconds =
    run.startedAt && run.completedAt
      ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 font-medium text-foreground capitalize">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[run.status]}`} aria-hidden />
        Run {run.status}
      </span>
      <span>
        Issued <strong className="font-semibold text-foreground tabular-nums">{run.issuedAt ? dt(run.issuedAt) : '—'}</strong>
        {run.issuedAt && ` · ${formatDistanceToNow(new Date(run.issuedAt), { addSuffix: true })}`}
      </span>
      <span className="capitalize">{run.trigger}</span>
      {seconds != null && <span className="tabular-nums">{seconds} s</span>}
    </div>
  );
}

function runKpis(run: KarhutlaRun, forecasts: KarhutlaForecast[], horizonHours: number): Kpi[] {
  const s = run.inputSummary;
  const fresh = forecasts.filter((f) => f.dataQuality.hotspotFreshness === 'fresh').length;
  const aging = forecasts.filter((f) => f.dataQuality.hotspotFreshness === 'aging').length;
  const stale = forecasts.length - fresh - aging;
  return [
    {
      label: 'Clusters forecast',
      value: String(forecasts.length),
      hint: s ? `of ${s.clustersFound} detected · max ${run.maxClusters} per run` : undefined,
      icon: Flame,
      tone: 'primary',
    },
    {
      label: 'Hotspots used',
      value: (s?.hotspotsUsed ?? 0).toLocaleString(),
      hint: s ? `${s.hotspotsInWindow.toLocaleString()} in ${run.hotspotWindowHours} h · ${s.excludedLowConfidence} low-conf. excluded` : undefined,
      icon: Satellite,
      tone: 'warning',
    },
    {
      label: `Places in forecast areas`,
      value: String(exposedPlacesAt(forecasts, horizonHours).length),
      hint: `spread + core/likely smoke · +${horizonHours} h`,
      icon: MapPin,
      tone: 'info',
    },
    {
      label: 'Fresh observations',
      value: `${fresh}/${forecasts.length}`,
      hint: `${aging} aging · ${stale} stale`,
      icon: Clock,
      tone: stale > 0 ? 'danger' : aging > 0 ? 'warning' : 'success',
    },
  ];
}

export default function KarhutlaPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canRun = role === 'admin' || role === 'agency_operator';
  const { data, isLoading, isError } = useKarhutlaLatest();
  const requestRun = useRequestKarhutlaRun();
  const run = data?.run ?? null;
  const forecasts = useMemo(() => run?.forecasts ?? [], [run]);
  const { data: verification } = useKarhutlaVerification(run?.id);

  const [horizon, setHorizon] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const horizons = run?.horizonsHours ?? [];
  const activeHorizon = horizon !== null && horizons.includes(horizon) ? horizon : (horizons[0] ?? 1);
  const selected = forecasts.find((f) => f.id === selectedId) ?? forecasts[0] ?? null;

  useEffect(() => {
    if (selectedId && !forecasts.some((f) => f.id === selectedId)) setSelectedId(null);
  }, [forecasts, selectedId]);

  const outdated =
    run?.issuedAt && Date.now() - new Date(run.issuedAt).getTime() > OUTDATED_AFTER_HOURS * 3_600_000;
  const degradedCount = forecasts.filter((f) => f.status !== 'ok' || f.dataQuality.issues.length > 0).length;
  const startRun = () =>
    requestRun.mutate(
      {},
      {
        onSuccess: ({ deduplicated }) =>
          toast.success(deduplicated ? 'A forecast run is already in progress' : 'Forecast run queued'),
        onError: () => toast.error('Could not start a forecast run'),
      },
    );

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={Flame}
        eyebrow="Experimental"
        title="Fire Spread & Smoke Forecast"
        description={
          run ? undefined : 'Potential spread envelopes and qualitative smoke transport around recent satellite hotspots.'
        }
        actions={
          canRun && (
            <Button onClick={startRun} disabled={requestRun.isPending || Boolean(data?.activeRun)}>
              {data?.activeRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {data?.activeRun ? 'Run in progress…' : 'Run forecast now'}
            </Button>
          )
        }
      >
        {run && <RunStatusLine run={run} />}
      </PageHeader>

      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          <strong className="font-semibold">Decision support only — verify before acting.</strong>{' '}
          {run?.disclaimer ??
            'Model outputs are uncalibrated scenarios, not predictions of certainty. Follow BPBD, BMKG and KLHK guidance.'}
        </span>
      </p>

      {data?.activeRun && (
        <Alert variant="info">
          <Loader2 className="animate-spin" />
          <AlertTitle>Forecast run {data.activeRun.status}</AlertTitle>
          <AlertDescription>
            Started {formatDistanceToNow(new Date(data.activeRun.startedAt ?? data.activeRun.createdAt), { addSuffix: true })}.
            The map below still shows the previous completed run.
          </AlertDescription>
        </Alert>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load forecasts</AlertTitle>
        </Alert>
      )}

      {run && (outdated || degradedCount > 0 || run.status === 'partial' || run.warnings.length > 0) && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Inputs stale or incomplete</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {outdated && <li>This forecast was issued more than {OUTDATED_AFTER_HOURS} h ago and is outdated.</li>}
              {degradedCount > 0 && (
                <li>
                  {degradedCount} of {forecasts.length} cluster forecasts have missing, stale or partial inputs — see each
                  cluster&apos;s Data tab.
                </li>
              )}
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
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
      ) : !run ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No completed forecast yet.{' '}
            {canRun ? 'Start one with “Run forecast now”.' : 'An operator can start one, or wait for the scheduled run.'}
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiRow kpis={runKpis(run, forecasts, activeHorizon)} />
          <KarhutlaSourceHealth run={run} forecasts={forecasts} />

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="gap-0 overflow-hidden py-0">
              <div className="h-[460px] sm:h-[560px]">
                <KarhutlaMap
                  forecasts={forecasts}
                  horizonHours={activeHorizon}
                  issuedAt={run.issuedAt}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="border-t border-border px-4 py-3">
                <KarhutlaTimeline
                  horizons={horizons}
                  activeHorizon={activeHorizon}
                  issuedAt={run.issuedAt}
                  onChange={setHorizon}
                />
              </div>
              <div className="grid grid-cols-1 gap-5 border-t border-border bg-muted/20 px-4 py-4 md:grid-cols-[minmax(0,1fr)_260px]">
                <KarhutlaLegend />
                {selected && <KarhutlaSpreadInset forecast={selected} horizonHours={activeHorizon} />}
              </div>
            </Card>

            <div className="space-y-5">
              <Card className="gap-0 py-0">
                <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">Clusters</h2>
                  {selectedId ? (
                    <button type="button" onClick={() => setSelectedId(null)} className="text-xs text-primary hover:underline">
                      Show all on map
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">ranked by the pipeline</span>
                  )}
                </div>
                <div className="max-h-[340px] overflow-y-auto p-2">
                  <KarhutlaClusterList
                    forecasts={forecasts}
                    horizonHours={activeHorizon}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </div>
              </Card>
              {selected && <KarhutlaDetailPanel key={selected.id} forecast={selected} horizonHours={activeHorizon} />}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Observed vs predicted (hotspot spot check)</CardTitle>
              <p className="text-xs text-muted-foreground">
                {verification?.method ??
                  'New hotspots detected after issue time, compared with the spread envelope and a persistence baseline.'}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Cluster</th>
                    <th className="py-2 pr-3 font-medium">Horizon</th>
                    <th className="py-2 pr-3 font-medium">New hotspots</th>
                    <th className="py-2 pr-3 font-medium">Inside envelope</th>
                    <th className="py-2 pr-3 font-medium">Inside observed footprint (persistence)</th>
                    <th className="py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(verification?.clusters ?? []).flatMap((c) =>
                    c.horizons.map((h) => (
                      <tr key={`${c.forecastId}-${h.horizonHours}`} className="border-b border-border/60">
                        <td className="py-2 pr-3">
                          <span className="text-muted-foreground tabular-nums">#{c.rank}</span>{' '}
                          {forecasts.find((f) => f.id === c.forecastId)?.location.label ?? ''}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">+{h.horizonHours} h</td>
                        <td className="py-2 pr-3 tabular-nums">{h.evaluable ? h.newHotspots : '—'}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {h.evaluable ? `${h.insideEnvelope} (${h.envelopeAreaKm2?.toLocaleString()} km²)` : '—'}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {h.evaluable ? `${h.insidePersistenceBaseline} (${h.baselineAreaKm2?.toLocaleString()} km²)` : '—'}
                        </td>
                        <td className="py-2 text-muted-foreground">{h.reason ?? ''}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                A larger envelope naturally contains more hotspots; compare counts together with areas. This is not an
                accuracy score.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

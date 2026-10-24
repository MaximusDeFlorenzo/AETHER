'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ExposedPlace, KarhutlaForecast, KarhutlaRecommendation, SmokeLevel } from '@/types/karhutla';
import { FRESHNESS_LABEL, formatKm } from './karhutla-utils';

const dt = (iso: string) => format(new Date(iso), 'dd MMM HH:mm');
const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

const PRIORITY_STYLES: Record<KarhutlaRecommendation['priority'], string> = {
  priority: 'border-danger/30 bg-danger/5',
  advisory: 'border-warning/30 bg-warning/5',
  info: 'border-border bg-muted/40',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mb-2 text-[11px] font-semibold tracking-wide uppercase', className)}>{children}</p>;
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-1">
      {notes.map((n) => (
        <li key={n} className="flex gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {n}
        </li>
      ))}
    </ul>
  );
}

function PlaceList({ places }: { places: ExposedPlace[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {places.slice(0, 24).map((p) => (
        <li
          key={`${p.source}:${p.id}`}
          className="rounded-md border border-border bg-card px-2 py-0.5 text-xs"
          title={`${p.kind === 'district_reference_point' ? 'District reference location (AETHER)' : `OSM ${p.placeType ?? 'place'}`} · ${p.distanceFromFireKm} km from fire`}
        >
          {p.name}
          <span className="ml-1 text-muted-foreground">{Math.round(p.distanceFromFireKm)} km</span>
        </li>
      ))}
      {places.length > 24 && <li className="text-xs text-muted-foreground">+{places.length - 24} more</li>}
    </ul>
  );
}

const EXPOSURE_GROUPS: Array<{ key: 'spread' | SmokeLevel; label: string; dot: string }> = [
  { key: 'spread', label: 'Inside potential spread', dot: 'bg-red-500' },
  { key: 'core', label: 'Smoke — core', dot: 'bg-zinc-500' },
  { key: 'likely', label: 'Smoke — likely', dot: 'bg-zinc-400' },
  { key: 'possible', label: 'Smoke — possible', dot: 'bg-zinc-300' },
];

export function KarhutlaDetailPanel({ forecast, horizonHours }: { forecast: KarhutlaForecast; horizonHours: number }) {
  const spread = forecast.predicted.spread;
  const smoke = forecast.predicted.smoke;
  const spreadH = spread?.horizons.find((h) => h.horizonHours === horizonHours);
  const smokeH = smoke?.horizons.find((h) => h.horizonHours === horizonHours);
  const exposure = forecast.exposure.find((e) => e.horizonHours === horizonHours);
  const dq = forecast.dataQuality;
  const limitations = Array.from(new Set([...(spread?.limitations ?? []), ...(smoke?.limitations ?? [])]));
  const horizonRows = (spread?.horizons ?? smoke?.horizons ?? []).map((h) => ({
    hours: h.horizonHours,
    spread: spread?.horizons.find((x) => x.horizonHours === h.horizonHours),
    smoke: smoke?.horizons.find((x) => x.horizonHours === h.horizonHours),
  }));
  const placesFor = (key: 'spread' | SmokeLevel) => (key === 'spread' ? exposure?.spread : exposure?.smoke[key]) ?? [];
  const anyExposed = EXPOSURE_GROUPS.some((g) => placesFor(g.key).length > 0);

  return (
    <Card className="gap-0 py-0">
      <div className="space-y-1.5 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            #{forecast.rank} {forecast.location.label ?? 'Unlabelled location'}
          </h2>
          {forecast.status !== 'ok' && <Badge variant="destructive">{forecast.status.replace('_', ' ')}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {forecast.confidence && (
            <Badge variant={forecast.confidence === 'very_low' ? 'destructive' : 'secondary'}>
              input quality: {forecast.confidence.replace('_', ' ')}
            </Badge>
          )}
          <span>Qualitative label — not a probability, not calibrated.</span>
        </div>
      </div>

      {forecast.error && (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {forecast.error}
        </p>
      )}

      <Tabs defaultValue="forecast" className="gap-0">
        <div className="overflow-x-auto px-4 pt-3">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="observed">Observed</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
            <TabsTrigger value="exposure">Exposure</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="observed" className="space-y-3 p-4">
          <SectionLabel className="text-orange-600 dark:text-orange-400">Satellite observation</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Hotspots" value={String(forecast.observed.hotspotCount)} hint={forecast.observed.sensors.join(', ')} />
            <Stat
              label="Total FRP"
              value={forecast.observed.totalFrpMw != null ? `${forecast.observed.totalFrpMw.toLocaleString()} MW` : '—'}
            />
            <Stat label="Latest detection" value={dt(forecast.observed.latestObservedAt)} hint={ago(forecast.observed.latestObservedAt)} />
            <Stat
              label="Freshness at issue"
              value={FRESHNESS_LABEL[dq.hotspotFreshness]}
              hint={`${dq.hotspotAgeHours} h old`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {forecast.observed.source}. Hotspots are ~1 km thermal anomalies, not confirmed fires or perimeters.
          </p>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-4 p-4">
          <div>
            <SectionLabel className="text-red-600 dark:text-red-400">Potential spread · +{horizonHours} h</SectionLabel>
            {spreadH?.status === 'ok' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Envelope area"
                    value={`${formatKm(spreadH.areaKm2, 2)} km²`}
                    hint={`observed footprint ${formatKm(spread?.observedFootprintAreaKm2, 2)} km²`}
                  />
                  <Stat
                    label="Max head advance"
                    value={`${formatKm(spreadH.maxHeadDistanceKm)} km`}
                    hint={spreadH.headBearingDeg != null ? `toward ${Math.round(spreadH.headBearingDeg)}°` : 'no spread'}
                  />
                  <Stat
                    label="Mean wind 10 m"
                    value={`${formatKm(spreadH.meanWindSpeedKmh)} km/h`}
                    hint={`from ${Math.round(spreadH.meanWindFromDeg ?? 0)}°`}
                  />
                  <Stat label="Hours grown" value={`${spreadH.hoursSinceObservation} h`} hint="since latest detection" />
                </div>
                {spreadH.factors && (
                  <p className="text-xs text-muted-foreground">
                    Fine-fuel moisture {spreadH.factors.estimatedFineFuelMoisturePct ?? '—'}% (factor{' '}
                    {spreadH.factors.moistureFactor}) · slope {spreadH.factors.slopeDeg ?? '—'}° (factor{' '}
                    {spreadH.factors.slopeFactor}) · length:breadth {spreadH.factors.lengthToBreadth}
                  </p>
                )}
                <Notes notes={spreadH.notes} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No envelope for this horizon. {spreadH?.notes.join(' ') ?? 'Spread engine produced no output.'}
              </p>
            )}
          </div>

          <div>
            <SectionLabel className="text-muted-foreground">Smoke transport · +{horizonHours} h · qualitative</SectionLabel>
            {smokeH?.status === 'ok' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Transport direction"
                    value={smokeH.transportBearingDeg != null ? `toward ${Math.round(smokeH.transportBearingDeg)}°` : 'stagnant'}
                  />
                  <Stat label="90% of particles within" value={`${formatKm(smokeH.p90DistanceKm, 0)} km`} />
                  <Stat
                    label="Likely class area"
                    value={`${formatKm(smokeH.footprint.find((c) => c.level === 'likely')?.areaKm2, 0)} km²`}
                  />
                  <Stat
                    label="Above boundary layer"
                    value={`${Math.round((smokeH.shareAboveBoundaryLayer ?? 0) * 100)}%`}
                    hint="of particles"
                  />
                </div>
                <Notes notes={[...smokeH.notes, ...(smoke?.warnings ?? [])]} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No smoke footprint for this horizon. {smokeH?.notes.join(' ') ?? 'Smoke engine produced no output.'}
              </p>
            )}
          </div>

          {horizonRows.length > 1 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Horizon</th>
                    <th className="px-2.5 py-1.5 font-medium">Spread km²</th>
                    <th className="px-2.5 py-1.5 font-medium">Head km</th>
                    <th className="px-2.5 py-1.5 font-medium">Smoke p90 km</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {horizonRows.map((r) => (
                    <tr
                      key={r.hours}
                      className={cn('border-t border-border', r.hours === horizonHours && 'bg-primary/5 font-semibold')}
                    >
                      <td className="px-2.5 py-1.5">+{r.hours} h</td>
                      <td className="px-2.5 py-1.5">{r.spread?.status === 'ok' ? formatKm(r.spread.areaKm2, 2) : '—'}</td>
                      <td className="px-2.5 py-1.5">{r.spread?.status === 'ok' ? formatKm(r.spread.maxHeadDistanceKm) : '—'}</td>
                      <td className="px-2.5 py-1.5">{r.smoke?.status === 'ok' ? formatKm(r.smoke.p90DistanceKm, 0) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Spread is an upper-bound scenario, not a perimeter that will burn. Smoke classes are particle density, not
            concentration.
          </p>
        </TabsContent>

        <TabsContent value="exposure" className="space-y-4 p-4">
          <div className="space-y-3">
            <SectionLabel className="text-muted-foreground">Known places · +{horizonHours} h</SectionLabel>
            {anyExposed ? (
              EXPOSURE_GROUPS.filter((g) => placesFor(g.key).length > 0).map((g) => (
                <div key={g.key}>
                  <p className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                    <span className={cn('h-2 w-2 rounded-full', g.dot)} aria-hidden />
                    {g.label}
                    <span className="text-muted-foreground tabular-nums">{placesFor(g.key).length}</span>
                  </p>
                  <PlaceList places={placesFor(g.key)} />
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No known places inside the forecast areas at this horizon.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Exposure only — being inside an area does not mean harm is expected. Places are OSM settlement points and
              AETHER district reference locations.
            </p>
          </div>

          <div className="space-y-2">
            <SectionLabel className="text-muted-foreground">Recommended precautions</SectionLabel>
            {forecast.recommendations.map((r) => (
              <div key={r.code} className={cn('rounded-lg border p-2.5 text-xs', PRIORITY_STYLES[r.priority])}>
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {r.priority} · for {r.audience}
                </p>
                <p className="text-foreground">{r.text}</p>
                <p className="mt-1 text-muted-foreground">Basis: {r.basis}</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="data" className="space-y-4 p-4 text-xs">
          <div className="space-y-1.5">
            <SectionLabel className="text-muted-foreground">Inputs</SectionLabel>
            <p>
              Weather: {forecast.weather?.provenance.attribution ?? 'unavailable'}
              {forecast.weather &&
                ` — model forecast (${forecast.weather.provenance.model}), retrieved ${dt(forecast.weather.retrievedAt)}`}
              {dq.weatherAgeMinutes != null && ` (${dq.weatherAgeMinutes} min before run)`}
            </p>
            <p>
              Weather coverage: {dq.weatherCoverage.firstHour ? dt(dq.weatherCoverage.firstHour) : '—'} →{' '}
              {dq.weatherCoverage.lastHour ? dt(dq.weatherCoverage.lastHour) : '—'}
            </p>
            <p>Wind grid coverage: {Math.round(dq.atmosphereGridCoverage * 100)}%</p>
            <p>Terrain: {forecast.weather?.terrain?.source ?? 'unavailable (flat terrain assumed)'}</p>
            <p className="text-muted-foreground">
              Models: {spread?.modelVersion ?? '—'} · {smoke?.modelVersion ?? '—'}
            </p>
            <Notes notes={dq.issues} />
          </div>
          {limitations.length > 0 && (
            <div>
              <SectionLabel className="text-muted-foreground">Limitations</SectionLabel>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

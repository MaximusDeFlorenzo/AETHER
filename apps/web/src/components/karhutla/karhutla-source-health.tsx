import { formatDistanceStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import type { KarhutlaForecast, KarhutlaRun } from '@/types/karhutla';

type Health = 'ok' | 'degraded' | 'missing' | 'off';

const DOT: Record<Health, string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  missing: 'bg-danger',
  off: 'border border-muted-foreground bg-transparent',
};
const HEALTH_LABEL: Record<Health, string> = { ok: 'OK', degraded: 'Degraded', missing: 'Missing', off: 'Disabled' };

interface SourceRow {
  name: string;
  health: Health;
  detail: string;
}

/** Coverage of a per-cluster input across the run's forecasts. */
function coverage(forecasts: KarhutlaForecast[], has: (f: KarhutlaForecast) => boolean): { health: Health; detail: string } {
  const n = forecasts.filter(has).length;
  if (!forecasts.length) return { health: 'off', detail: 'no clusters' };
  return {
    health: n === forecasts.length ? 'ok' : n === 0 ? 'missing' : 'degraded',
    detail: `${n}/${forecasts.length} clusters`,
  };
}

function sourceRows(run: KarhutlaRun, forecasts: KarhutlaForecast[]): SourceRow[] {
  const sources = run.inputSummary?.sources ?? [];
  const issued = run.issuedAt ? new Date(run.issuedAt) : null;
  const firms = sources.find((s) => s.id === 'nasa_firms');
  const osm = sources.find((s) => s.id === 'openstreetmap');
  const rows: SourceRow[] = [];

  if (firms) {
    const latest = firms.latestObservationAt ? new Date(firms.latestObservationAt) : null;
    const ageH = latest && issued ? (issued.getTime() - latest.getTime()) / 3_600_000 : null;
    rows.push({
      name: 'NASA FIRMS',
      health: ageH == null ? 'missing' : ageH <= 6 ? 'ok' : 'degraded',
      detail: latest && issued ? `latest pass ${formatDistanceStrict(latest, issued)} before run` : 'no hotspots',
    });
  }
  rows.push({ name: 'Open-Meteo weather', ...coverage(forecasts, (f) => f.weather !== null) });
  rows.push({ name: 'Terrain (GLO-90)', ...coverage(forecasts, (f) => Boolean(f.weather?.terrain)) });
  if (osm?.enabled === false) {
    rows.push({ name: 'OpenStreetMap places', health: 'off', detail: 'disabled by config' });
  } else if (osm) {
    rows.push({
      name: 'OpenStreetMap places',
      ...coverage(forecasts, (f) => !f.recommendations.some((r) => r.code === 'SETTLEMENT_DATA_MISSING')),
    });
  }
  rows.push({
    name: 'Prediction models',
    health: run.modelVersions.spread && run.modelVersions.smoke ? 'ok' : 'degraded',
    detail: [run.modelVersions.spread && 'spread', run.modelVersions.smoke && 'smoke'].filter(Boolean).join(' + ') || 'none',
  });
  return rows;
}

export function KarhutlaSourceHealth({ run, forecasts }: { run: KarhutlaRun; forecasts: KarhutlaForecast[] }) {
  return (
    <section
      aria-label="Data source status"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs"
    >
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Data sources</span>
      {sourceRows(run, forecasts).map((row) => (
        <span key={row.name} className="flex items-center gap-2" title={HEALTH_LABEL[row.health]}>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[row.health])} aria-hidden />
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-muted-foreground">{row.detail}</span>
          <span className="sr-only">({HEALTH_LABEL[row.health]})</span>
        </span>
      ))}
    </section>
  );
}

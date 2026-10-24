'use client';

import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Activity, AlertTriangle, AudioWaveform, Gauge, Mountain, Waves } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KpiRow, type Kpi } from '@/components/dashboard/kpi-row';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { EarthquakeMap } from '@/components/earthquake/earthquake-map-loader';
import { EarthquakeDetailPanel } from '@/components/earthquake/earthquake-detail-panel';
import {
  type EarthquakeEvent,
  MAGNITUDE_CLASSES,
  MAGNITUDE_LABEL,
  depthClass,
  formatMagnitude,
  isEarthquake,
  isSimulated,
  magnitudeColor,
} from '@/components/earthquake/earthquake-utils';
import { EARTHQUAKE_MAGNITUDE_COLORS } from '@/lib/chart-colors';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { cn } from '@/lib/utils';

// The API caps a page at 200 rows; BMKG's "gempa terkini" feed lists M5+
// quakes, so 30 days stays well under that in practice.
const PAGE_LIMIT = 200;

const WINDOWS = [
  { key: '24h', label: '24 h', hours: 24 },
  { key: '7d', label: '7 d', hours: 24 * 7 },
  { key: '30d', label: '30 d', hours: 24 * 30 },
] as const;
type WindowKey = (typeof WINDOWS)[number]['key'];

const MIN_MAGNITUDES = [0, 5, 6] as const;

const HOUR_MS = 3_600_000;

const dt = (iso: string) => format(new Date(iso), 'dd MMM yyyy HH:mm');

function earthquakeKpis(events: EarthquakeEvent[], windowLabel: string): Kpi[] {
  const strongest = events.reduce<EarthquakeEvent | null>(
    (max, e) => (!max || e.details.magnitude > max.details.magnitude ? e : max),
    null,
  );
  const tsunami = events.filter((e) => e.details.potentialTsunami).length;
  const shallowFelt = events.filter((e) => e.details.magnitude >= 5 && depthClass(e.details.depthKm) === 'shallow').length;
  return [
    {
      label: 'Earthquakes',
      value: String(events.length),
      hint: `last ${windowLabel}`,
      icon: Activity,
      tone: 'primary',
    },
    {
      label: 'Strongest',
      value: strongest ? formatMagnitude(strongest.details.magnitude) : '—',
      hint: strongest ? (strongest.region ?? strongest.locationLabel ?? undefined) : 'no event in window',
      icon: Gauge,
      tone: strongest && strongest.details.magnitude >= 6 ? 'danger' : 'info',
    },
    {
      label: 'Tsunami potential',
      value: String(tsunami),
      hint: 'as flagged by BMKG',
      icon: Waves,
      tone: tsunami > 0 ? 'danger' : 'success',
    },
    {
      label: 'Shallow M5+',
      value: String(shallowFelt),
      hint: 'depth < 70 km — most damaging',
      icon: Mountain,
      tone: shallowFelt > 0 ? 'warning' : 'success',
    },
  ];
}

function EventRow({
  e,
  selected,
  onSelect,
}: {
  e: EarthquakeEvent;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(e.id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
          selected ? 'bg-primary/10' : 'hover:bg-muted/60',
        )}
      >
        <span
          className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white tabular-nums"
          style={{ background: magnitudeColor(e.details.magnitude) }}
        >
          {e.details.magnitude.toFixed(1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{e.locationLabel ?? e.region ?? 'Unnamed location'}</span>
          <span className="block truncate text-muted-foreground">
            {formatDistanceToNow(new Date(e.eventTime), { addSuffix: true })} · {e.details.depthKm} km deep
            {e.details.potentialTsunami && ' · tsunami potential'}
            {isSimulated(e) && ' · simulated'}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function EarthquakePage() {
  const [windowKey, setWindowKey] = useState<WindowKey>('7d');
  const [minMagnitude, setMinMagnitude] = useState<number>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const win = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1];

  // Rounded to the hour so the query key stays stable between refetches.
  const from = useMemo(
    () => new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - win.hours * HOUR_MS).toISOString(),
    [win.hours],
  );
  const { data, isLoading, isError } = useHazardEvents({ hazardType: 'earthquake', from, limit: PAGE_LIMIT });

  const events = useMemo(() => (data?.data ?? []).filter(isEarthquake), [data]);
  const shown = useMemo(() => events.filter((e) => e.details.magnitude >= minMagnitude), [events, minMagnitude]);
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shown;
    return shown.filter((e) =>
      [e.locationLabel, e.region].some((s) => (s ?? '').toLowerCase().includes(q)),
    );
  }, [shown, query]);
  const selected = shown.find((e) => e.id === selectedId) ?? listed[0] ?? null;
  const truncated = data ? data.meta.total > events.length : false;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={AudioWaveform}
        eyebrow="Live"
        title="Earthquake Monitor"
        description="Recent earthquakes across Indonesia from BMKG, with magnitude, depth, tsunami potential and the nearest districts."
        actions={
          <div role="radiogroup" aria-label="Time window" className="flex rounded-md border border-border p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                role="radio"
                aria-checked={windowKey === w.key}
                onClick={() => setWindowKey(w.key)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium',
                  windowKey === w.key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      >
        {events[0] && (
          <p className="text-xs text-muted-foreground">
            Latest event {dt(events[0].eventTime)} ({formatDistanceToNow(new Date(events[0].eventTime), { addSuffix: true })})
          </p>
        )}
      </PageHeader>

      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          <strong className="font-semibold">Decision support only — verify before acting.</strong> Parameters are
          BMKG&apos;s automatic first estimates and may be revised; official tsunami warnings come from BMKG InaTEWS only.
        </span>
      </p>

      {isError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load earthquakes</AlertTitle>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-5">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-[560px] w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          <KpiRow kpis={earthquakeKpis(events, win.label)} />

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card className="gap-0 overflow-hidden py-0">
              <div className="h-[460px] sm:h-[560px]">
                <EarthquakeMap events={shown} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-xs">
                {MAGNITUDE_CLASSES.map((c) => (
                  <span key={c} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: EARTHQUAKE_MAGNITUDE_COLORS[c] }}
                      aria-hidden
                    />
                    {MAGNITUDE_LABEL[c]}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-danger" aria-hidden />
                  Tsunami potential
                </span>
                <span className="text-muted-foreground">Size by magnitude · epicentres</span>
              </div>
            </Card>

            <div className="space-y-5">
              <Card className="gap-0 py-0">
                <div className="space-y-2 border-b border-border px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold">Events</h2>
                    <span className="text-xs text-muted-foreground">newest first</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search location"
                      className="h-8 text-xs"
                    />
                    <div role="radiogroup" aria-label="Minimum magnitude" className="flex shrink-0 rounded-md border border-border p-0.5">
                      {MIN_MAGNITUDES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={minMagnitude === m}
                          onClick={() => setMinMagnitude(m)}
                          className={cn(
                            'rounded px-2 py-0.5 text-[11px] font-medium',
                            minMagnitude === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {m === 0 ? 'All' : `M${m}+`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <ul className="max-h-[340px] overflow-y-auto p-2">
                  {listed.length ? (
                    listed.map((e) => (
                      <EventRow key={e.id} e={e} selected={e.id === selected?.id} onSelect={setSelectedId} />
                    ))
                  ) : (
                    <li className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                      {query ? 'No location matches.' : 'No earthquake in this window.'}
                    </li>
                  )}
                </ul>
              </Card>
              {selected && <EarthquakeDetailPanel key={selected.id} event={selected} />}
            </div>
          </div>

          <Card>
            <CardContent className="space-y-2 py-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Sources</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Earthquakes: BMKG &quot;gempa terkini&quot; feed (M5+), polled by the ingestion scheduler</li>
                <li>Nearest districts: distance from epicentre to district reference points (not boundaries)</li>
                {truncated && (
                  <li className="text-warning">
                    Showing the latest {events.length} of {data.meta.total} events — narrow the window to see all.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

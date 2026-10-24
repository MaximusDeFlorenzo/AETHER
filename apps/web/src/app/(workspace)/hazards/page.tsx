'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Search, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { HazardMap } from '@/components/map/map-loader';
import { HazardTypeBadge, HAZARD_TYPE_ICONS } from '@/components/shared/hazard-type-badge';
import { SortableTableHead } from '@/components/shared/sortable-table-head';
import { TablePagination } from '@/components/shared/table-pagination';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { usePagination } from '@/hooks/use-pagination';
import { useSortableData } from '@/hooks/use-sortable-data';
import { ALL_HAZARD_TYPES, HAZARD_TYPE_LABELS } from '@/lib/labels';
import { formatHazardEventLocation } from '@/lib/hazard-severity';
import { cn } from '@/lib/utils';
import type { EarthquakeDetails, FloodDetails, HazardEvent, HazardType, WildfireDetails } from '@/types/domain';
import { PageHeader } from '@/components/shared/page-header';

type HazardSortKey = 'location' | 'severity' | 'time' | 'affected';

function hazardSeverityValue(event: HazardEvent): number {
  if (event.hazardType === 'earthquake') {
    return (event.details as EarthquakeDetails | null)?.magnitude ?? 0;
  }
  if (event.hazardType === 'flood') {
    return (event.details as FloodDetails | null)?.waterLevelM ?? 0;
  }
  if (event.hazardType === 'wildfire') {
    return (event.details as WildfireDetails | null)?.frpConfidence ?? 0;
  }
  return 0;
}

function getHazardSortValue(event: HazardEvent, key: HazardSortKey) {
  switch (key) {
    case 'location':
      return formatHazardEventLocation(event);
    case 'severity':
      return hazardSeverityValue(event);
    case 'time':
      return new Date(event.eventTime).getTime();
    case 'affected':
      return event.affectedRegionCount ?? 0;
  }
}

function hazardSeverityLabel(event: HazardEvent): string {
  if (event.hazardType === 'earthquake') {
    return `M${((event.details as EarthquakeDetails | null)?.magnitude ?? 0).toFixed(1)}`;
  }
  if (event.hazardType === 'flood') {
    const waterLevelM = (event.details as FloodDetails | null)?.waterLevelM;
    return waterLevelM != null ? `${waterLevelM}m` : '—';
  }
  if (event.hazardType === 'wildfire') {
    const frpConfidence = (event.details as WildfireDetails | null)?.frpConfidence;
    return frpConfidence != null ? `${Math.round(frpConfidence * 100)}%` : '—';
  }
  return '—';
}

export default function HazardEventsPage() {
  const [hazardType, setHazardType] = useState<HazardType | 'all'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useHazardEvents({
    hazardType: hazardType === 'all' ? undefined : hazardType,
    limit: 100,
  });

  // Lightweight (limit: 1) count-only queries per hazard type, so the quick
  // filter row below can show e.g. "Earthquake 12" without capping on the
  // main list's 100-row page and without an extra backend aggregate route —
  // docs/API_SPEC.md's /hazard-events already returns an accurate meta.total
  // per filtered query.
  const totalCount = useHazardEvents({ limit: 1 });
  const earthquakeCount = useHazardEvents({ hazardType: 'earthquake', limit: 1 });
  const landslideCount = useHazardEvents({ hazardType: 'landslide', limit: 1 });
  const floodCount = useHazardEvents({ hazardType: 'flood', limit: 1 });
  const wildfireCount = useHazardEvents({ hazardType: 'wildfire', limit: 1 });
  const hazardTypeCounts: Record<HazardType, number | undefined> = {
    earthquake: earthquakeCount.data?.meta.total,
    landslide: landslideCount.data?.meta.total,
    flood: floodCount.data?.meta.total,
    wildfire: wildfireCount.data?.meta.total,
  };

  const filtered = useMemo(() => {
    const events = data?.data ?? [];
    if (!search.trim()) return events;
    const term = search.toLowerCase();
    return events.filter((e) => formatHazardEventLocation(e).toLowerCase().includes(term));
  }, [data, search]);

  const { sorted, sortKey, sortDirection, toggleSort } = useSortableData<HazardEvent, HazardSortKey>(
    filtered,
    getHazardSortValue,
    { key: 'time', direction: 'desc' },
  );
  const { pageData, page, pageCount, setPage, canPrev, canNext, total } = usePagination(sorted, 10);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader icon={Activity} title="Hazard Events"
        description={<>Live ingestion feed — {data?.meta.total ?? 0} events recorded.</>}
      />

      <div className="space-y-1.5">
        <Label htmlFor="search">Search location</Label>
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="search"
            placeholder="e.g. Bantul, Palu, Sumatra"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Quick hazard-type filters — one tap straight to "how many
          earthquake/flood/wildfire/landslide events right now" instead of
          opening a dropdown first. */}
      <div className="grid grid-cols-5 gap-2">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setHazardType('all')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setHazardType('all');
          }}
          className={cn(
            'cursor-pointer border-primary/40 py-0 transition-colors hover:border-primary/70',
            hazardType === 'all' && 'border-primary bg-primary/5',
          )}
        >
          <CardContent className="px-3 py-2.5">
            <p className="truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase">All</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {totalCount.data?.meta.total ?? '—'}
            </p>
          </CardContent>
        </Card>
        {ALL_HAZARD_TYPES.map((type) => {
          const Icon = HAZARD_TYPE_ICONS[type];
          const active = hazardType === type;
          return (
            <Card
              key={type}
              role="button"
              tabIndex={0}
              onClick={() => setHazardType(type)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setHazardType(type);
              }}
              className={cn(
                'cursor-pointer border-primary/40 py-0 transition-colors hover:border-primary/70',
                active && 'border-primary bg-primary/5',
              )}
            >
              <CardContent className="flex items-start justify-between gap-1.5 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {HAZARD_TYPE_LABELS[type]}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {hazardTypeCounts[type] ?? '—'}
                  </p>
                </div>
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Map</CardTitle>
        </CardHeader>
        <CardContent className="h-[420px] sm:h-[480px]">
          {isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : <HazardMap events={filtered} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    sortKey="location"
                    label="Location"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    sortKey="severity"
                    label="Severity"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    sortKey="time"
                    label="Time"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    sortKey="affected"
                    label="Affected regions"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading &&
                  pageData.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Link href={`/hazards/${event.id}`} className="hover:underline">
                          {formatHazardEventLocation(event)}
                        </Link>
                        <HazardTypeBadge hazardType={event.hazardType} className="ml-2" />
                      </TableCell>
                      <TableCell className="text-sm">{hazardSeverityLabel(event)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-sm">{event.affectedRegionCount ?? 0}</TableCell>
                    </TableRow>
                  ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No hazard events match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              pageCount={pageCount}
              total={total}
              canPrev={canPrev}
              canNext={canNext}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
    </div>
  );
}

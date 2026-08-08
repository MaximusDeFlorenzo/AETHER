'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { HazardMap } from '@/components/map/map-loader';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { SortableTableHead } from '@/components/shared/sortable-table-head';
import { TablePagination } from '@/components/shared/table-pagination';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { usePagination } from '@/hooks/use-pagination';
import { useSortableData } from '@/hooks/use-sortable-data';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { EarthquakeDetails, FloodDetails, HazardEvent, HazardType, WildfireDetails } from '@/types/domain';

type HazardSortKey = 'location' | 'severity' | 'time' | 'affected';

function hazardSeverityValue(event: HazardEvent): number {
  if (event.hazardType === 'earthquake') {
    return (event.details as EarthquakeDetails).magnitude ?? 0;
  }
  if (event.hazardType === 'flood') {
    return (event.details as FloodDetails).waterLevelM ?? 0;
  }
  if (event.hazardType === 'wildfire') {
    return (event.details as WildfireDetails).frpConfidence ?? 0;
  }
  return 0;
}

function getHazardSortValue(event: HazardEvent, key: HazardSortKey) {
  switch (key) {
    case 'location':
      return event.locationLabel;
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
    return `M${((event.details as EarthquakeDetails).magnitude ?? 0).toFixed(1)}`;
  }
  if (event.hazardType === 'flood') {
    const waterLevelM = (event.details as FloodDetails).waterLevelM;
    return waterLevelM != null ? `${waterLevelM}m` : '—';
  }
  if (event.hazardType === 'wildfire') {
    const frpConfidence = (event.details as WildfireDetails).frpConfidence;
    return frpConfidence != null ? `${Math.round(frpConfidence * 100)}%` : '—';
  }
  return '—';
}

const HAZARD_TYPE_OPTIONS: { value: HazardType | 'all'; label: string }[] = [
  { value: 'all', label: 'All hazard types' },
  { value: 'earthquake', label: HAZARD_TYPE_LABELS.earthquake },
  { value: 'landslide', label: HAZARD_TYPE_LABELS.landslide },
  { value: 'flood', label: HAZARD_TYPE_LABELS.flood },
  { value: 'wildfire', label: HAZARD_TYPE_LABELS.wildfire },
];

export default function HazardEventsPage() {
  const [hazardType, setHazardType] = useState<HazardType | 'all'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useHazardEvents({
    hazardType: hazardType === 'all' ? undefined : hazardType,
    limit: 100,
  });

  const filtered = useMemo(() => {
    const events = data?.data ?? [];
    if (!search.trim()) return events;
    const term = search.toLowerCase();
    return events.filter((e) => e.locationLabel?.toLowerCase().includes(term));
  }, [data, search]);

  const { sorted, sortKey, sortDirection, toggleSort } = useSortableData<HazardEvent, HazardSortKey>(
    filtered,
    getHazardSortValue,
    { key: 'time', direction: 'desc' },
  );
  const { pageData, page, pageCount, setPage, canPrev, canNext, total } = usePagination(sorted, 10);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hazard Events</h1>
        <p className="text-sm text-muted-foreground">
          Live ingestion feed — {data?.meta.total ?? 0} events recorded.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="search">Search location</Label>
          <div className="relative">
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
        <div className="w-56 space-y-1.5">
          <Label>Hazard type</Label>
          <Select value={hazardType} onValueChange={(v) => setHazardType((v as HazardType | 'all') ?? 'all')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HAZARD_TYPE_OPTIONS.map((opt) => (
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
                          {event.locationLabel}
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

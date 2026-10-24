'use client';

import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { format } from 'date-fns';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { useAnalytics } from '@/hooks/use-dashboard';
import { useHistoricalDisasters } from '@/hooks/use-historical';
import { useProvinces } from '@/hooks/use-geo';
import { PageHeader } from '@/components/shared/page-header';

const AnalyticsCharts = dynamic(() => import('@/components/charts/analytics-charts'), {
  ssr: false,
  loading: () => (
    <>
      <Card>
        <CardContent className="h-64 pt-6">
          <Skeleton className="h-full w-full" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="h-64 pt-6">
            <Skeleton className="h-full w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="h-64 pt-6">
            <Skeleton className="h-full w-full" />
          </CardContent>
        </Card>
      </div>
    </>
  ),
});

// Generalizes ORION's analytics/page.tsx — analyst/agency-only workspace
// page. `historical_disasters` now carries a hazardType filter
// (docs/API_SPEC.md §9).
export default function AnalyticsPage() {
  const [province, setProvince] = useState<string>('all');

  const { data: provinces = [] } = useProvinces();
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics(
    province === 'all' ? {} : { province },
  );
  const { data: historicalPage, isLoading: historicalLoading } = useHistoricalDisasters(
    province === 'all' ? { limit: 50 } : { province, limit: 50 },
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={BarChart3}
        title="Analytics"
        description="Trends from live hazard-event ingestion and BNPB historical disaster data."
        actions={
      <div className="w-56 space-y-1.5">
        <Label>Province</Label>
        <Select value={province} onValueChange={(v) => setProvince(v ?? 'all')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All provinces</SelectItem>
            {provinces.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
        }
      />

      <AnalyticsCharts analytics={analytics} isLoading={analyticsLoading} />

      <Card>
        <CardHeader>
          <CardTitle>BNPB Historical Disaster Data</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Hazard type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Casualties</TableHead>
                <TableHead>Displaced</TableHead>
                <TableHead>Damaged buildings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historicalLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!historicalLoading &&
                (historicalPage?.data ?? []).map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{format(new Date(record.eventDate), 'dd MMM yyyy')}</TableCell>
                    <TableCell>
                      <HazardTypeBadge hazardType={record.hazardType} />
                    </TableCell>
                    <TableCell>
                      {record.district ? `${record.district.name}, ` : ''}
                      {record.province.name}
                    </TableCell>
                    <TableCell>{record.casualtiesDead.toLocaleString()}</TableCell>
                    <TableCell>{record.displacedPopulation.toLocaleString()}</TableCell>
                    <TableCell>{record.damagedBuildingsCount.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              {!historicalLoading && (historicalPage?.data.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No historical records found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

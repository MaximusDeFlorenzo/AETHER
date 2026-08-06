'use client';

import { format } from 'date-fns';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CHART_AXIS, CHART_GRID, CHART_INFO, CHART_PRIMARY, hazardTypeToColor } from '@/lib/chart-colors';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { AnalyticsResponse } from '@/hooks/use-dashboard';

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
};

// Generalizes ORION's charts/analytics-charts.tsx: earthquake-count-over-time
// stays, magnitude-distribution becomes hazard-type distribution (a bar per
// HazardType instead of a magnitude bucket).
export default function AnalyticsCharts({
  analytics,
  isLoading,
}: {
  analytics: AnalyticsResponse | undefined;
  isLoading: boolean;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Hazard Event Frequency Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics?.hazardEventCountsByDay ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis
                  dataKey="date"
                  stroke={CHART_AXIS}
                  fontSize={12}
                  tickFormatter={(v) => format(new Date(v), 'dd MMM')}
                />
                <YAxis stroke={CHART_AXIS} fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(v) => format(new Date(String(v)), 'dd MMM yyyy')}
                />
                <Area type="monotone" dataKey="count" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hazard Type Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.hazardTypeDistribution ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="hazardType"
                    stroke={CHART_AXIS}
                    fontSize={12}
                    tickFormatter={(v) => HAZARD_TYPE_LABELS[v as keyof typeof HAZARD_TYPE_LABELS]}
                  />
                  <YAxis stroke={CHART_AXIS} fontSize={12} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {(analytics?.hazardTypeDistribution ?? []).map((entry) => (
                      <Cell key={entry.hazardType} fill={hazardTypeToColor(entry.hazardType)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historical Casualties by Year (BNPB)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.historicalCasualtiesByYear ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="year" stroke={CHART_AXIS} fontSize={12} />
                  <YAxis stroke={CHART_AXIS} fontSize={12} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="totalDeaths" fill={CHART_INFO} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

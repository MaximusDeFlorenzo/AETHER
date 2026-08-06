'use client';

import { format } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_AXIS, CHART_GRID, CHART_PRIMARY } from '@/lib/chart-colors';

export default function DashboardActivityChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis
          dataKey="date"
          stroke={CHART_AXIS}
          fontSize={12}
          tickFormatter={(v) => format(new Date(v), 'dd MMM')}
        />
        <YAxis stroke={CHART_AXIS} fontSize={12} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--popover-foreground)',
          }}
          labelFormatter={(v) => format(new Date(String(v)), 'dd MMM yyyy')}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={CHART_PRIMARY}
          fill={CHART_PRIMARY}
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

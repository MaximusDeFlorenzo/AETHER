'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS, CHART_GRID } from '@/lib/chart-colors';

// Replaces ORION's historical-magnitude-chart.tsx — generalized to a
// hazard-agnostic "severity" axis (magnitude for earthquake, a 0-10 scale
// for other hazard types) so the same chart works on any hazard detail page.
export interface HistoricalSeverityDatum {
  label: string;
  severity: number;
  fill: string;
}

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
};

export default function HistoricalSeverityChart({ data }: { data: HistoricalSeverityDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis dataKey="label" stroke={CHART_AXIS} fontSize={12} />
        <YAxis stroke={CHART_AXIS} fontSize={12} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="severity" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

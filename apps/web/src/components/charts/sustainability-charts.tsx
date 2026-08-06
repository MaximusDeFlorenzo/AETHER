'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS, CHART_GRID, CHART_PRIMARY } from '@/lib/chart-colors';
import type { SdgIndicator } from '@/types/domain';

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
};

// New for AETHER's public Sustainability Dashboard (docs/API_SPEC.md §8) —
// ORION never had an SDG/accountability surface. Grouped horizontal bars:
// "Score" (achieved) vs "Target" per SDG indicator — two fixed series (never
// cycled per-indicator hues, since the comparison is magnitude not
// identity), legend present because there are 2 series.
export default function SustainabilityCharts({ indicators }: { indicators: SdgIndicator[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={indicators} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} stroke={CHART_AXIS} fontSize={12} />
        <YAxis type="category" dataKey="label" stroke={CHART_AXIS} fontSize={12} width={140} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="score" name="Score" fill={CHART_PRIMARY} radius={[0, 4, 4, 0]} barSize={12} />
        <Bar dataKey="target" name="Target" fill={CHART_GRID} radius={[0, 4, 4, 0]} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}

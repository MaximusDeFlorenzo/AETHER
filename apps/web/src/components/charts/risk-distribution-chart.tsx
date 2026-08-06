'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_AXIS } from '@/lib/chart-colors';

// Replaces ORION's damage-distribution-chart.tsx — bucketed by the
// hazard-agnostic ExposureLevel enum instead of earthquake-only DamageLevel.
export interface RiskDistributionDatum {
  level: string;
  count: number;
  fill: string;
}

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
};

export default function RiskDistributionChart({ data }: { data: RiskDistributionDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="level" stroke={CHART_AXIS} fontSize={12} />
        <YAxis stroke={CHART_AXIS} fontSize={12} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.level} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

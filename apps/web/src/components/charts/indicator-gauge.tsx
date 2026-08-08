'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CHART_DANGER, CHART_SUCCESS, CHART_WARNING } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';

const TONE_COLOR = {
  success: CHART_SUCCESS,
  warning: CHART_WARNING,
  danger: CHART_DANGER,
} as const;

export type GaugeTone = keyof typeof TONE_COLOR;

// Half-donut "vital sign monitor" gauge for a single SDG indicator's score
// (0-100) — replaces the per-indicator linear progress bar. Built as a
// two-slice Pie restricted to the top half-circle (startAngle 180 -> 0),
// the standard Recharts speedometer recipe, rather than a full chart-library
// gauge component (none of Recharts' primitives is a dedicated gauge).
export function IndicatorGauge({ score, tone, className }: { score: number; tone: GaugeTone; className?: string }) {
  const clamped = Math.min(100, Math.max(0, score));
  const data = [
    { value: clamped, fill: TONE_COLOR[tone] },
    { value: 100 - clamped, fill: 'var(--muted)' },
  ];

  return (
    <div className={cn('relative h-20 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="100%"
            startAngle={180}
            endAngle={0}
            innerRadius="65%"
            outerRadius="95%"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <span className="text-xl font-semibold tabular-nums text-foreground">{clamped}</span>
      </div>
    </div>
  );
}

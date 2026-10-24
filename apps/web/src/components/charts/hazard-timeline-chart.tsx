'use client';

import { useMemo, useState } from 'react';
import { format, startOfDay, subDays } from 'date-fns';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HAZARD_TYPE_COLORS } from '@/lib/chart-colors';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { HazardType } from '@/types/domain';

export interface HazardDayCount {
  date: string;
  hazardType: HazardType;
  count: number;
}

const HAZARD_ORDER: HazardType[] = ['wildfire', 'flood', 'landslide', 'earthquake'];

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 3 months' },
];

const chartConfig = Object.fromEntries(
  HAZARD_ORDER.map((type) => [type, { label: HAZARD_TYPE_LABELS[type], color: HAZARD_TYPE_COLORS[type] }]),
) satisfies ChartConfig;

type Selection = 'all' | HazardType;

// Daily hazard-event counts per type (`/analytics` hazardEventCountsByDay),
// shadcn interactive-area style. Wildfire satellite detections outnumber the
// other hazards by orders of magnitude (thousands vs. a handful a day), so
// "All hazards" plots wildfire on its own right-hand axis and the rest on
// the left — on one shared scale they would sit flat on zero. The tabs
// isolate a single type.
export default function HazardTimelineChart({ data, className }: { data: HazardDayCount[]; className?: string }) {
  const [range, setRange] = useState('30');
  const [selected, setSelected] = useState<Selection>('all');

  const { rows, totals } = useMemo(() => {
    const days = Number(range);
    const today = startOfDay(new Date());
    const byDay = new Map<string, Record<string, number | string>>();
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = format(subDays(today, i), 'yyyy-MM-dd');
      byDay.set(key, { date: key, wildfire: 0, flood: 0, landslide: 0, earthquake: 0 });
    }
    const sums: Record<HazardType, number> = { wildfire: 0, flood: 0, landslide: 0, earthquake: 0 };
    for (const point of data) {
      const row = byDay.get(format(new Date(point.date), 'yyyy-MM-dd'));
      if (!row || !(point.hazardType in sums)) continue;
      row[point.hazardType] = (row[point.hazardType] as number) + point.count;
      sums[point.hazardType] += point.count;
    }
    return { rows: [...byDay.values()], totals: sums };
  }, [data, range]);

  const series = selected === 'all' ? HAZARD_ORDER : [selected];
  // Separate axes only when wildfire shares the plot with other hazards.
  const splitAxes = selected === 'all';
  const axisFor = (type: HazardType) => (splitAxes && type === 'wildfire' ? 'wildfire' : 'main');
  const compact = (value: number) => value.toLocaleString('en-US', { notation: 'compact' });
  const grandTotal = HAZARD_ORDER.reduce((sum, type) => sum + totals[type], 0);
  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase();

  const tabs: { key: Selection; label: string; total: number; color?: string }[] = [
    { key: 'all', label: 'All hazards', total: grandTotal },
    ...HAZARD_ORDER.map((type) => ({
      key: type,
      label: HAZARD_TYPE_LABELS[type],
      total: totals[type],
      color: HAZARD_TYPE_COLORS[type],
    })),
  ];

  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardHeader className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <CardTitle className="text-base">Hazard Timeline</CardTitle>
          <CardDescription>New hazard events per day, {rangeLabel}</CardDescription>
        </div>
        <Select value={range} onValueChange={(v) => v && setRange(v)}>
          <SelectTrigger className="w-[160px] rounded-lg" aria-label="Time range">
            <SelectValue>{(value: string) => RANGES.find((r) => r.value === value)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value} className="rounded-lg">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <div role="tablist" aria-label="Hazard type" className="grid grid-cols-2 border-b border-border sm:grid-cols-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected === tab.key}
            onClick={() => setSelected(tab.key)}
            className={cn(
              'flex flex-col items-start gap-1 border-border px-5 py-3 text-left transition-colors even:border-l sm:border-l sm:first:border-l-0',
              selected === tab.key ? 'bg-muted/60' : 'hover:bg-muted/30',
            )}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {tab.color && <span className="h-2 w-2 rounded-full" style={{ background: tab.color }} />}
              {tab.label}
            </span>
            <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">
              {tab.total.toLocaleString('en-US')}
            </span>
          </button>
        ))}
      </div>

      <CardContent className="px-2 pt-4 pb-3 sm:px-5">
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={rows} margin={{ left: 4, right: 8 }}>
            <defs>
              {HAZARD_ORDER.map((type) => (
                <linearGradient key={type} id={`fill-${type}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${type})`} stopOpacity={0.7} />
                  <stop offset="95%" stopColor={`var(--color-${type})`} stopOpacity={0.08} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value: string) => format(new Date(value), 'd MMM')}
            />
            <YAxis
              yAxisId="main"
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
              tickFormatter={compact}
            />
            {splitAxes && (
              <YAxis
                yAxisId="wildfire"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
                tickFormatter={compact}
                tick={{ fill: HAZARD_TYPE_COLORS.wildfire }}
              />
            )}
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value) => format(new Date(String(value)), 'EEE, d MMM yyyy')}
                />
              }
            />
            {series.map((type) => (
              <Area
                key={type}
                yAxisId={axisFor(type)}
                dataKey={type}
                type="monotone"
                fill={`url(#fill-${type})`}
                fillOpacity={splitAxes && type === 'wildfire' ? 0.5 : 1}
                stroke={`var(--color-${type})`}
                strokeWidth={splitAxes && type !== 'wildfire' ? 2 : 1.5}
                stackId={axisFor(type)}
              />
            ))}
          </AreaChart>
        </ChartContainer>
        {splitAxes && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
            {HAZARD_ORDER.map((type) => (
              <span key={type} className="flex items-center gap-1.5 text-foreground">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: HAZARD_TYPE_COLORS[type] }} />
                {HAZARD_TYPE_LABELS[type]}
                {type === 'wildfire' && <span className="text-muted-foreground">(right axis)</span>}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

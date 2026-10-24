import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type KpiTone = 'primary' | 'info' | 'success' | 'warning' | 'danger';

const TONE_STYLES: Record<KpiTone, string> = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon: LucideIcon;
  tone?: KpiTone;
}

// Flat KPI card grid — restrained enterprise-SaaS surface (no gradients, no
// backdrop-blur, no giant colored icons): label and tinted icon chip on one
// row, the figure below, and a hint line that is always reserved so every
// card in the row lines up at the same height.
export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const tone = kpi.tone ?? 'primary';
        return (
          <Card key={kpi.label} className="h-full py-0 transition-colors hover:border-primary/50">
            <CardContent className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-muted-foreground">{kpi.label}</p>
                <span
                  className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_STYLES[tone])}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="flex items-baseline gap-1.5 text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
                {kpi.value}
                {kpi.unit && <span className="text-sm font-medium tracking-normal text-muted-foreground">{kpi.unit}</span>}
              </p>
              <p className="mt-auto line-clamp-2 min-h-[2lh] text-xs leading-snug text-muted-foreground">
                {kpi.hint ?? '\u00a0'}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

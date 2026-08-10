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
// backdrop-blur, no giant colored icons): a plain white card with a blue
// border on all sides, navy figures, and a small tinted icon chip whose
// tone still distinguishes the metric's category.
export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const tone = kpi.tone ?? 'primary';
        return (
          <Card key={kpi.label} className="border-primary/40 py-0 transition-colors hover:border-primary/70">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {kpi.label}
                </p>
                <p className="mt-1.5 flex items-baseline gap-1 text-2xl font-semibold tabular-nums text-foreground">
                  {kpi.value}
                  {kpi.unit && <span className="text-xs font-medium text-muted-foreground">{kpi.unit}</span>}
                </p>
                {kpi.hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{kpi.hint}</p>}
              </div>
              <span
                className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_STYLES[tone])}
              >
                <Icon className="h-4 w-4" />
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

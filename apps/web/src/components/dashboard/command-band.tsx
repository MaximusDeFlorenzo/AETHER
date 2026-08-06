import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CommandKpi {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  warn?: boolean;
}

interface CommandBandProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  livePillIcon?: LucideIcon;
  livePillLabel?: string;
  kpis: CommandKpi[];
}

// The dashboard's dark "mission control" hero band — built entirely from
// existing semantic tokens (sidebar/primary/brand-accent), so it reads as
// deep ocean blue on the light theme and near-black ocean on the dark theme
// without any hardcoded colors of its own.
export function CommandBand({
  eyebrow,
  title,
  subtitle,
  livePillIcon: LivePillIcon,
  livePillLabel,
  kpis,
}: CommandBandProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-lg ring-1 ring-black/5">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 8% 12%, color-mix(in oklch, var(--primary), transparent 35%) 0%, transparent 55%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div className="relative z-10 px-5 pt-5 pb-6 sm:px-7 sm:pt-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/60 uppercase">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
              {subtitle && (
                <span className="ml-2 text-sm font-normal text-sidebar-foreground/60">{subtitle}</span>
              )}
            </h1>
          </div>
          {livePillLabel && (
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-accent/40 bg-brand-accent/15 px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-accent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-accent opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-accent" />
              </span>
              {LivePillIcon && <LivePillIcon className="h-3 w-3" />}
              {livePillLabel}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="bg-sidebar/60 px-4 py-3.5 backdrop-blur-sm sm:px-5 sm:py-4">
              <p className="text-[10.5px] font-medium tracking-wide text-sidebar-foreground/55 uppercase">
                {kpi.label}
              </p>
              <p
                className={cn(
                  'mt-1.5 flex items-baseline gap-1.5 font-mono text-xl font-bold tabular-nums sm:text-2xl',
                  kpi.warn ? 'text-brand-accent' : 'text-sidebar-foreground',
                )}
              >
                {kpi.value}
                {kpi.unit && (
                  <span className="text-xs font-medium text-sidebar-foreground/50">{kpi.unit}</span>
                )}
              </p>
              {kpi.hint && (
                <p className="mt-0.5 truncate text-[11px] text-sidebar-foreground/50">{kpi.hint}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

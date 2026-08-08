"use client";

import { Leaf, ShieldCheck, Target, TrendingUp, Users } from "lucide-react";
import { KpiRow, type Kpi } from "@/components/dashboard/kpi-row";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IndicatorGauge } from "@/components/charts/indicator-gauge";
import { useSustainabilityMetrics } from "@/hooks/use-sustainability";
import { cn } from "@/lib/utils";

// New public accountability surface (docs/API_SPEC.md §8) — ORION never had
// an SDG/sustainability dashboard. Public, no auth required.
export default function SustainabilityPage() {
  const { data: metrics, isLoading } = useSustainabilityMetrics();
  const indicators = metrics?.sdgIndicators ?? [];

  const kpis: Kpi[] = [
    {
      label: "Climate Resilience Score",
      value: isLoading ? "—" : String(Math.round(metrics?.climateResilienceScore ?? 0)),
      unit: "/100",
      icon: ShieldCheck,
      tone: "success",
    },
    {
      label: "Carbon Reduction Estimate",
      value: isLoading ? "—" : (metrics?.carbonReductionEstimateTons ?? 0).toLocaleString(),
      unit: "t CO₂e",
      icon: Leaf,
      tone: "success",
    },
    {
      label: "Protected Population",
      value: isLoading ? "—" : (metrics?.protectedPopulation ?? 0).toLocaleString(),
      icon: Users,
      tone: "primary",
    },
    {
      label: "Response Efficiency Score",
      value: isLoading ? "—" : String(Math.round(metrics?.responseEfficiencyScore ?? 0)),
      unit: "/100",
      icon: TrendingUp,
      tone: "info",
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Public Accountability
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Sustainability Dashboard
          {metrics && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              — {metrics.periodStart.slice(0, 10)} to {metrics.periodEnd.slice(0, 10)}
            </span>
          )}
        </h1>
      </div>

      <KpiRow kpis={kpis} />

      <div>
        <h2 className="mb-3 text-base font-medium">SDG Indicators</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : indicators.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No SDG indicator data available for this period yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {indicators.map((indicator) => {
              const onTarget = indicator.score >= indicator.target;
              const nearTarget = !onTarget && indicator.score >= indicator.target * 0.7;
              const tone = onTarget ? "success" : nearTarget ? "warning" : "danger";
              return (
                <Card key={indicator.goal}>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        <Target className="h-3 w-3" /> {indicator.goal}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          tone === "success" && "bg-success/10 text-success",
                          tone === "warning" && "bg-warning/10 text-warning",
                          tone === "danger" && "bg-danger/10 text-danger",
                        )}
                      >
                        {onTarget ? "On target" : "Below target"}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{indicator.label}</p>
                    <IndicatorGauge score={indicator.score} tone={tone} />
                    <p className="text-center text-xs text-muted-foreground">target {indicator.target}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import {
  CommandBand,
  type CommandKpi,
} from "@/components/dashboard/command-band";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSustainabilityMetrics } from "@/hooks/use-sustainability";

const SustainabilityCharts = dynamic(
  () => import("@/components/charts/sustainability-charts"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  },
);

// New public accountability surface (docs/API_SPEC.md §8) — ORION never had
// an SDG/sustainability dashboard. Public, no auth required.
export default function SustainabilityPage() {
  const { data: metrics, isLoading } = useSustainabilityMetrics();

  const kpis: CommandKpi[] = [
    {
      label: "Climate Resilience Score",
      value: isLoading
        ? "—"
        : String(Math.round(metrics?.climateResilienceScore ?? 0)),
      unit: "/100",
    },
    {
      label: "Carbon Reduction Estimate",
      value: isLoading
        ? "—"
        : (metrics?.carbonReductionEstimateTons ?? 0).toLocaleString(),
      unit: "t CO₂e",
    },
    {
      label: "Protected Population",
      value: isLoading
        ? "—"
        : (metrics?.protectedPopulation ?? 0).toLocaleString(),
    },
    {
      label: "Response Efficiency Score",
      value: isLoading
        ? "—"
        : String(Math.round(metrics?.responseEfficiencyScore ?? 0)),
      unit: "/100",
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CommandBand
        eyebrow="Public Accountability"
        title="Sustainability Dashboard"
        subtitle={
          metrics
            ? `— ${metrics.periodStart.slice(0, 10)} to ${metrics.periodEnd.slice(0, 10)}`
            : undefined
        }
        kpis={kpis}
      />

      <Card>
        <CardHeader>
          <CardTitle>SDG Indicators — Score vs. Target</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <SustainabilityCharts indicators={metrics?.sdgIndicators ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

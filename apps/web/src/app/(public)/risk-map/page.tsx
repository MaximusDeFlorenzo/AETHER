'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  Bell,
  ClipboardList,
  Leaf,
  Lock,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardMap } from '@/components/map/map-loader';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { KpiRow, type Kpi } from '@/components/dashboard/kpi-row';
import { useDashboardSummary, useAnalytics } from '@/hooks/use-dashboard';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { useSpatialOverlay } from '@/hooks/use-spatial-overlay';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { useDecisionRecommendations } from '@/hooks/use-decision-recommendations';
import { useNotifications } from '@/hooks/use-notifications';
import { useSustainabilityMetrics } from '@/hooks/use-sustainability';
import { useAuthStore } from '@/stores/auth-store';
import { EXPOSURE_LEVEL_COLORS } from '@/lib/chart-colors';
import { EXPOSURE_LEVEL_LABELS, HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { ExposureLevel, SpatialOverlayLayer } from '@/types/domain';

const DashboardActivityChart = dynamic(() => import('@/components/charts/dashboard-activity-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});
const RiskDistributionChart = dynamic(() => import('@/components/charts/risk-distribution-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const OVERLAY_OPTIONS: { value: SpatialOverlayLayer | 'none'; label: string }[] = [
  { value: 'none', label: 'No overlay' },
  { value: 'risk', label: 'Risk zones' },
  { value: 'vulnerability', label: 'Vulnerability zones' },
  { value: 'exposure', label: 'Exposure zones' },
];

const EXPOSURE_ORDER: ExposureLevel[] = ['low', 'moderate', 'high', 'severe'];

// The Phase 1 multi-hazard operations dashboard: top KPI row, a large
// interactive map, a right-side alert/recommendation panel, and bottom
// trend charts — BMKG-style layout. Generalizes ORION's earthquake-only
// dashboard map to earthquake + landslide + flood + wildfire markers, plus a
// GeoJSON polygon overlay toggle ORION never had (docs/API_SPEC.md §6).
export default function RiskMapPage() {
  const router = useRouter();
  const [overlayLayer, setOverlayLayer] = useState<SpatialOverlayLayer | 'none'>('risk');
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthed = !!accessToken;

  const { data: eventsPage, isLoading: eventsLoading } = useHazardEvents({ limit: 200 });
  const events = useMemo(() => eventsPage?.data ?? [], [eventsPage]);

  const { data: overlay } = useSpatialOverlay(
    { layer: overlayLayer === 'none' ? 'risk' : overlayLayer },
    overlayLayer !== 'none',
  );

  const { data: summary } = useDashboardSummary();
  const { data: analytics } = useAnalytics();
  // /risk-assessments and /decision-recommendations require auth
  // (docs/API_SPEC.md) — gated so anonymous visitors to this public
  // dashboard don't 401 and get hard-redirected to /admin/login by the
  // apiClient's global 401 handler (lib/api-client.ts).
  const { data: riskAssessments } = useRiskAssessments({ limit: 200 }, isAuthed);
  const { data: recommendations, isLoading: recsLoading } = useDecisionRecommendations({ limit: 5 }, isAuthed);
  const { data: notifications = [] } = useNotifications();
  const { data: sustainability } = useSustainabilityMetrics();

  const { highRiskDistrictCount, populationAtRisk, riskDistribution } = useMemo(() => {
    const assessments = riskAssessments?.data ?? [];
    const highRiskDistricts = new Map<string, number>();
    const counts: Record<ExposureLevel, number> = { low: 0, moderate: 0, high: 0, severe: 0 };

    for (const assessment of assessments) {
      if (assessment.exposureLevel) counts[assessment.exposureLevel] += 1;
      if (assessment.exposureLevel === 'high' || assessment.exposureLevel === 'severe') {
        const prev = highRiskDistricts.get(assessment.district.id) ?? 0;
        highRiskDistricts.set(
          assessment.district.id,
          Math.max(prev, assessment.estimatedAffectedPopulation ?? 0),
        );
      }
    }

    return {
      highRiskDistrictCount: highRiskDistricts.size,
      populationAtRisk: Array.from(highRiskDistricts.values()).reduce((sum, n) => sum + n, 0),
      riskDistribution: EXPOSURE_ORDER.map((level) => ({
        level: EXPOSURE_LEVEL_LABELS[level],
        count: counts[level],
        fill: EXPOSURE_LEVEL_COLORS[level],
      })),
    };
  }, [riskAssessments]);

  const recentEvents = (summary?.recentHazardEvents?.length ? summary.recentHazardEvents : events).slice(0, 6);
  const unreadFirst = [...notifications].sort((a, b) => Number(a.isRead) - Number(b.isRead)).slice(0, 6);

  const kpis: Kpi[] = [
    {
      label: 'Active Hazards',
      value: String(summary?.activeHazardEventCount ?? eventsPage?.meta.total ?? 0),
      icon: Activity,
      tone: 'danger',
    },
    {
      label: 'High Risk Districts',
      value: isAuthed ? String(highRiskDistrictCount) : '—',
      hint: isAuthed ? undefined : 'Sign in to view',
      icon: MapPin,
      tone: 'warning',
    },
    {
      label: 'Population at Risk',
      value: isAuthed ? populationAtRisk.toLocaleString() : '—',
      hint: isAuthed ? undefined : 'Sign in to view',
      icon: Users,
      tone: 'danger',
    },
    {
      label: 'Decision Recommendations',
      value: isAuthed ? String(recommendations?.meta.total ?? 0) : '—',
      hint: isAuthed ? undefined : 'Sign in to view',
      icon: ClipboardList,
      tone: 'primary',
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Risk Intelligence Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live earthquake, landslide, flood, and wildfire monitoring across Indonesia.
        </p>
      </div>

      <KpiRow kpis={kpis} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> Indonesia — Interactive Hazard Map
          </CardTitle>
          <div className="w-44 shrink-0">
            <Select
              value={overlayLayer}
              onValueChange={(v) => setOverlayLayer((v as SpatialOverlayLayer | 'none') ?? 'none')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERLAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="h-[520px] sm:h-[600px]">
          {eventsLoading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : (
            <HazardMap
              events={events}
              overlay={overlayLayer === 'none' ? null : overlay}
              overlayLabel={
                overlayLayer === 'none'
                  ? 'Overlay'
                  : OVERLAY_OPTIONS.find((o) => o.value === overlayLayer)?.label
              }
              onSelect={(id) => router.push(`/hazards/${id}`)}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" /> Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {unreadFirst.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No active alerts.</p>
            )}
            {unreadFirst.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-sm">
                {!n.isRead && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />}
                <div className={n.isRead ? 'min-w-0 pl-3.5' : 'min-w-0'}>
                  <p className="truncate font-medium text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Recent Events
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {recentEvents.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No recent events.</p>
            )}
            {recentEvents.map((event) => (
              <Link
                key={event.id}
                href={`/hazards/${event.id}`}
                className="block rounded-lg px-1.5 py-1 -mx-1.5 text-sm transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2">
                  <HazardTypeBadge hazardType={event.hazardType} />
                  <span className="truncate font-medium text-foreground">
                    {event.locationLabel ?? HAZARD_TYPE_LABELS[event.hazardType]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(event.eventTime), { addSuffix: true })}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> AI Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isAuthed && (
              <Link
                href="/admin/login"
                className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" /> Sign in to view AI recommendations
              </Link>
            )}
            {isAuthed && recsLoading &&
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            {isAuthed && !recsLoading && (recommendations?.data.length ?? 0) === 0 && (
              <p className="py-2 text-sm text-muted-foreground">No recommendations yet.</p>
            )}
            {(recommendations?.data ?? []).map((rec) => {
              const hazardEventId = rec.riskAssessment.hazardEvent?.id;
              const content = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {rec.riskAssessment.district.name}
                    </span>
                    <PriorityBadge level={rec.priorityLevel} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{rec.summaryText}</p>
                </>
              );
              return hazardEventId ? (
                <Link
                  key={rec.id}
                  href={`/hazards/${hazardEventId}`}
                  className="block rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-muted"
                >
                  {content}
                </Link>
              ) : (
                <Link
                  key={rec.id}
                  href="/decision-intelligence"
                  className="block rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-muted"
                >
                  {content}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hazard Timeline</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <DashboardActivityChart data={analytics?.hazardEventCountsByDay ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {isAuthed ? (
              <RiskDistributionChart data={riskDistribution} />
            ) : (
              <Link
                href="/admin/login"
                className="flex h-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" /> Sign in to view
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sustainability Metrics</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <div className="grid flex-1 grid-cols-2 gap-3">
              <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Climate Resilience</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {Math.round(sustainability?.climateResilienceScore ?? 0)}
                  <span className="text-xs font-normal text-muted-foreground">/100</span>
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Protected Population</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {(sustainability?.protectedPopulation ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Carbon Reduction</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {(sustainability?.carbonReductionEstimateTons ?? 0).toLocaleString()}
                  <span className="text-xs font-normal text-muted-foreground"> t</span>
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Response Efficiency</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {Math.round(sustainability?.responseEfficiencyScore ?? 0)}
                  <span className="text-xs font-normal text-muted-foreground">/100</span>
                </p>
              </div>
            </div>
            <Link
              href="/sustainability"
              className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Leaf className="h-3 w-3" /> View full dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

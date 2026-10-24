'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Activity, Bell, ClipboardList, MapPin, Users, Map as MapIcon } from 'lucide-react';
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
import { LiveIndicator } from '@/components/shared/live-indicator';
import { KpiRow, type Kpi } from '@/components/dashboard/kpi-row';
import { AiDecisionIntelligence } from '@/components/dashboard/ai-decision-intelligence';
import { useDashboardSummary, useAnalytics } from '@/hooks/use-dashboard';
import { useHazardEvents } from '@/hooks/use-hazard-events';
import { useSpatialOverlay } from '@/hooks/use-spatial-overlay';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { useDecisionRecommendations } from '@/hooks/use-decision-recommendations';
import { useNotifications } from '@/hooks/use-notifications';
import { formatHazardEventLocation } from '@/lib/hazard-severity';
import type { SpatialOverlayLayer } from '@/types/domain';
import { PageHeader } from '@/components/shared/page-header';

const HazardTimelineChart = dynamic(() => import('@/components/charts/hazard-timeline-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-xl" />,
});

const OVERLAY_OPTIONS: { value: SpatialOverlayLayer | 'none'; label: string }[] = [
  { value: 'none', label: 'No overlay' },
  { value: 'risk', label: 'Risk zones' },
  { value: 'vulnerability', label: 'Vulnerability zones' },
  { value: 'exposure', label: 'Exposure zones' },
];


// The AI Risk Intelligence Platform dashboard: page header, KPI row, a large
// interactive map, a prominent AI decision-intelligence panel, recent
// hazard/alert activity, and supporting analytics — in that order. Generalizes
// ORION's earthquake-only dashboard map to earthquake + landslide + flood +
// wildfire markers, plus a GeoJSON polygon overlay toggle ORION never had
// (docs/API_SPEC.md §6).
export default function RiskMapPage() {
  const router = useRouter();
  const [overlayLayer, setOverlayLayer] = useState<SpatialOverlayLayer | 'none'>('risk');

  const { data: eventsPage, isLoading: eventsLoading, dataUpdatedAt } = useHazardEvents({ limit: 200 });
  const events = useMemo(() => eventsPage?.data ?? [], [eventsPage]);

  const { data: overlay } = useSpatialOverlay(
    { layer: overlayLayer === 'none' ? 'risk' : overlayLayer },
    overlayLayer !== 'none',
  );

  const { data: summary } = useDashboardSummary();
  const { data: analytics } = useAnalytics();
  const { data: riskAssessments } = useRiskAssessments({ limit: 200 });
  const { data: recommendations, isLoading: recsLoading } = useDecisionRecommendations({ limit: 20 });
  const { data: notifications = [] } = useNotifications();

  const { highRiskDistrictCount, populationAtRisk } = useMemo(() => {
    const assessments = riskAssessments?.data ?? [];
    const highRiskDistricts = new Map<string, number>();

    for (const assessment of assessments) {
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
    };
  }, [riskAssessments]);

  const recentEvents = (summary?.recentHazardEvents?.length ? summary.recentHazardEvents : events).slice(0, 5);
  const unreadFirst = [...notifications].sort((a, b) => Number(a.isRead) - Number(b.isRead)).slice(0, 5);

  const formatCount = (n: number) => n.toLocaleString('en-US');
  const kpis: Kpi[] = [
    {
      label: 'Active Hazards',
      value: formatCount(summary?.activeHazardEventCount ?? eventsPage?.meta.total ?? 0),
      hint: 'New events in the last 24 h, mostly satellite fire detections',
      icon: Activity,
      tone: 'danger',
    },
    {
      label: 'High Risk Districts',
      value: formatCount(highRiskDistrictCount),
      hint: 'Districts rated high or severe in the latest assessments',
      icon: MapPin,
      tone: 'warning',
    },
    {
      label: 'Population at Risk',
      value: formatCount(populationAtRisk),
      unit: 'people',
      hint: 'Estimated affected population in those districts',
      icon: Users,
      tone: 'danger',
    },
    {
      label: 'AI Decision Recommendations',
      value: formatCount(recommendations?.meta.total ?? 0),
      hint: 'All-time total generated by the decision engine',
      icon: ClipboardList,
      tone: 'primary',
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      {/* 1. Page header */}
      <PageHeader
        icon={MapIcon}
        eyebrow="Indonesia"
        title="Risk Intelligence"
        description="Real-time environmental risk intelligence and decision support."
        actions={<LiveIndicator updatedAt={dataUpdatedAt} />}
      />

      {/* 2. Key metrics */}
      <KpiRow kpis={kpis} />

      {/* 3. Large interactive Indonesia risk map */}
      <Card className="py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 border-b border-border py-3.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-primary" /> Indonesia — Interactive Hazard Map
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
        <CardContent className="h-[520px] p-3 sm:h-[640px] sm:p-4">
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

      {/* Daily hazard activity, right under the map */}
      <HazardTimelineChart data={analytics?.hazardEventCountsByDay ?? []} />

      {/* 4. AI / Decision Intelligence + 5. Recent hazard/activity information */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AiDecisionIntelligence
            recommendations={recommendations?.data ?? []}
            total={recommendations?.meta.total ?? 0}
            isLoading={recsLoading}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-primary" /> Active Alerts
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
                <Activity className="h-4 w-4 text-primary" /> Recent Events
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
                  className="-mx-1.5 block rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <HazardTypeBadge hazardType={event.hazardType} />
                    <span className="truncate font-medium text-foreground">
                      {formatHazardEventLocation(event)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(event.eventTime), { addSuffix: true })}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

'use client';

import { use } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Clock,
  Compass,
  Info,
  MapPin,
  Users,
  Waves,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardMap } from '@/components/map/map-loader';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { RiskLevelBadge } from '@/components/shared/risk-level-badge';
import { useAffectedRegions, useHazardEvent, useHazardEventRelationships } from '@/hooks/use-hazard-events';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { useDecisionRecommendations } from '@/hooks/use-decision-recommendations';
import { RISK_ASSESSMENT_STATUS_LABELS } from '@/lib/labels';
import { formatHazardEventLocation } from '@/lib/hazard-severity';
import { getHazardDetailMetrics } from '@/lib/hazard-metrics';
import type { EarthquakeDetails } from '@/types/domain';

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}

function MetricCard({ icon: Icon, label, value, hint }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function HazardEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: event, isLoading } = useHazardEvent(id);
  const { data: affectedRegions = [], isLoading: regionsLoading } = useAffectedRegions(id);
  const { data: relationships = [] } = useHazardEventRelationships(id);
  const { data: riskAssessmentsPage } = useRiskAssessments({ hazardEventId: id, limit: 50 });
  const { data: recommendationsPage } = useDecisionRecommendations({ hazardEventId: id });

  if (isLoading || !event) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const riskAssessments = riskAssessmentsPage?.data ?? [];
  const recommendations = recommendationsPage?.data ?? [];

  const totalAffectedPopulation = riskAssessments.reduce(
    (sum, ra) => sum + (ra.estimatedAffectedPopulation ?? 0),
    0,
  );
  const affectedRadiusKm = affectedRegions.reduce((max, r) => Math.max(max, r.distanceKm), 0);
  const worstExposure = riskAssessments
    .map((ra) => ra.exposureLevel)
    .filter((level): level is NonNullable<typeof level> => !!level)
    .sort((a, b) => {
      const order = { low: 0, moderate: 1, high: 2, severe: 3 } as const;
      return order[b] - order[a];
    })[0];

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{formatHazardEventLocation(event)}</h1>
            <HazardTypeBadge hazardType={event.hazardType} />
            {event.hazardType === 'earthquake' &&
              (event.details as EarthquakeDetails).potentialTsunami && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-xs font-semibold text-white">
                  <Waves className="h-3 w-3" /> Potential tsunami
                </span>
              )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {getHazardDetailMetrics(event.hazardType, event.details).map((m) => (
              <MetricCard key={m.label} icon={m.icon} label={m.label} value={m.value} />
            ))}
            <MetricCard icon={MapPin} label="Region" value={event.region ?? '—'} />
            <MetricCard
              icon={Clock}
              label="Time"
              value={format(new Date(event.eventTime), 'dd MMM yyyy HH:mm')}
            />
            <MetricCard
              icon={Compass}
              label="Coordinates"
              value={`${event.latitude.toFixed(3)}, ${event.longitude.toFixed(3)}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimated Impact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard
                icon={Users}
                label="Estimated affected population"
                value={totalAffectedPopulation.toLocaleString()}
              />
              <div className="rounded-lg border border-border/60 p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </span>
                  Exposure level
                </div>
                <div className="mt-2">
                  {worstExposure ? (
                    <RiskLevelBadge level={worstExposure} />
                  ) : (
                    <span className="text-sm">—</span>
                  )}
                </div>
              </div>
              <MetricCard
                icon={Compass}
                label="Affected radius"
                value={affectedRadiusKm > 0 ? `${affectedRadiusKm.toFixed(1)} km` : '—'}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" /> Location
            </CardTitle>
          </CardHeader>
          <CardContent className="h-80 sm:h-96">
            <HazardMap events={[event]} showTypeFilter={false} showOverlayToggle={false} focusZoom={10} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Affected Regions
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 space-y-3 overflow-y-auto">
            {regionsLoading && <Skeleton className="h-24 w-full" />}
            {!regionsLoading && affectedRegions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No districts identified within this event&apos;s impact radius yet.
              </p>
            )}
            {affectedRegions.map((region) => {
              const assessment = riskAssessments.find((ra) => ra.district.id === region.district.id);
              return (
                <div
                  key={region.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-4 py-3 text-sm transition-colors hover:border-border hover:bg-muted/40"
                >
                  <div>
                    <p className="font-medium">{region.district.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {region.distanceKm.toFixed(1)} km from event
                      {assessment?.estimatedAffectedPopulation != null &&
                        ` · ~${assessment.estimatedAffectedPopulation.toLocaleString()} people potentially affected`}
                    </p>
                  </div>
                  {assessment &&
                    (assessment.status === 'completed' && assessment.exposureLevel ? (
                      <RiskLevelBadge level={assessment.exposureLevel} />
                    ) : (
                      <span className="rounded-full border px-2.5 py-0.5 text-xs">
                        {RISK_ASSESSMENT_STATUS_LABELS[assessment.status]}
                      </span>
                    ))}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {relationships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cascading Hazard Relationships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {relationships.map((rel) => (
              <div key={rel.id} className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                <p className="font-medium text-warning">{rel.relationshipType}</p>
                <p className="mt-1 text-muted-foreground">{rel.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision Recommendations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {recommendations.length === 0 && (
            <Alert variant="info">
              <Info />
              <AlertDescription>
                No recommendations yet — the decision intelligence pipeline may still be processing.
              </AlertDescription>
            </Alert>
          )}
          {recommendations.map((rec, index) => (
            <div
              key={rec.id}
              className={
                index === 0
                  ? 'rounded-lg border border-warning/30 bg-warning/10 p-4'
                  : 'rounded-lg border border-border/60 p-4'
              }
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PriorityBadge level={rec.priorityLevel} />
                  <span className="text-sm font-medium">{rec.riskAssessment.district.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {Math.round(rec.confidenceScore * 100)}% confidence
                </span>
              </div>
              <p className="text-sm leading-relaxed">{rec.summaryText}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{rec.actionRecommendation}</p>
              <ul className="mt-3 space-y-1">
                {rec.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-medium text-foreground">{reason.factor}:</span> {reason.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

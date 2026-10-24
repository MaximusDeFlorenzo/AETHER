'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, GitBranch, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { TablePagination } from '@/components/shared/table-pagination';
import { useDecisionRecommendations } from '@/hooks/use-decision-recommendations';
import { usePagination } from '@/hooks/use-pagination';
import type { PriorityLevel } from '@/types/domain';
import { PageHeader } from '@/components/shared/page-header';

const PRIORITY_OPTIONS: { value: PriorityLevel | 'all'; label: string }[] = [
  { value: 'all', label: 'All priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// Generalizes ORION's priority-response/page.tsx: ranked list by priority,
// with the reasons[] bulleted XAI panel per item, now also surfacing a
// cascading-hazard reason when the underlying event has a detected
// hazard_relationships row (docs/API_SPEC.md §5).
export default function DecisionIntelligencePage() {
  const [priority, setPriority] = useState<PriorityLevel | 'all'>('all');
  const { data, isLoading } = useDecisionRecommendations(
    priority === 'all' ? {} : { priorityLevel: priority },
  );
  const recommendations = data?.data ?? [];
  const { pageData, page, pageCount, setPage, canPrev, canNext, total } = usePagination(recommendations, 8);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={ShieldAlert}
        title="Decision Intelligence"
        description="Districts ranked by AI-computed response priority, highest first."
        actions={
      <div className="w-48 space-y-1.5">
        <Label>Filter by priority</Label>
        <Select value={priority} onValueChange={(v) => setPriority((v as PriorityLevel | 'all') ?? 'all')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
        }
      />

      <div className="space-y-3">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}

        {!isLoading && recommendations.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No recommendations match this filter.
            </CardContent>
          </Card>
        )}

        {pageData.map((rec, index) => (
          <Card key={rec.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {(page - 1) * 8 + index + 1}
                  </span>
                  <CardTitle className="text-base">
                    {rec.riskAssessment.hazardEvent ? (
                      <Link href={`/hazards/${rec.riskAssessment.hazardEvent.id}`} className="hover:underline">
                        {rec.riskAssessment.district.name}
                      </Link>
                    ) : (
                      rec.riskAssessment.district.name
                    )}
                  </CardTitle>
                  <HazardTypeBadge hazardType={rec.riskAssessment.hazardType} />
                  <PriorityBadge level={rec.priorityLevel} />
                  {rec.hasCascadingHazard && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning ring-1 ring-warning/25">
                      <GitBranch className="h-3 w-3" /> Cascading
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(rec.createdAt), 'dd MMM yyyy HH:mm')}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Priority score: {rec.priorityScore.toFixed(1)}/100</span>
                <span>Confidence: {Math.round(rec.confidenceScore * 100)}%</span>
                {rec.riskAssessment.estimatedAffectedPopulation != null && (
                  <span>
                    Est. affected: {rec.riskAssessment.estimatedAffectedPopulation.toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed">{rec.summaryText}</p>
              <p className="text-sm font-medium text-foreground">{rec.actionRecommendation}</p>
              <ul className="mt-2 space-y-1">
                {rec.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-medium text-foreground">{reason.factor}:</span> {reason.detail}
                      {reason.weight != null && (
                        <span className="ml-1 text-muted-foreground/70">(weight {reason.weight.toFixed(2)})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <TablePagination
        page={page}
        pageCount={pageCount}
        total={total}
        canPrev={canPrev}
        canNext={canNext}
        onPageChange={setPage}
      />
    </div>
  );
}

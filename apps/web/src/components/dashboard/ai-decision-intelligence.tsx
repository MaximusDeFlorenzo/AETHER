import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { PRIORITY_LEVEL_COLORS } from '@/lib/chart-colors';
import type { DecisionRecommendation } from '@/types/domain';

interface AiDecisionIntelligenceProps {
  recommendations: DecisionRecommendation[];
  total: number;
  isLoading: boolean;
}

// The dashboard's clearest signal that AETHER is an *AI* risk-intelligence
// platform, not just a hazard map — surfaces the real
// useDecisionRecommendations data (priorityScore/confidenceScore/
// actionRecommendation are all model output, docs/API_SPEC.md §5) rather
// than inventing a separate "AI summary" widget. If the backend later adds
// fields (e.g. a numeric predicted-impact distinct from priorityScore), this
// component's data model is the natural place to consume them.
export function AiDecisionIntelligence({
  recommendations,
  total,
  isLoading,
}: AiDecisionIntelligenceProps) {
  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 border-b border-border bg-navy px-5 py-4 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <Sparkles className="h-4 w-4 text-cyan" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">AI Decision Intelligence</p>
            <p className="text-xs text-white/60">Model-ranked response recommendations</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-cyan tabular-nums">
          {String(total).padStart(2, '0')} ACTIONS
        </span>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}

        {!isLoading && recommendations.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recommendations yet — the AI engine will surface actions here as new risk assessments come in.
          </p>
        )}

        {recommendations.map((rec) => {
            const hazardEventId = rec.riskAssessment.hazardEvent?.id;
            const href = hazardEventId ? `/hazards/${hazardEventId}` : '/decision-intelligence';
            return (
              <Link
                key={rec.id}
                href={href}
                className="group/rec relative block overflow-hidden rounded-lg border border-border pl-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: PRIORITY_LEVEL_COLORS[rec.priorityLevel] }}
                  aria-hidden="true"
                />
                <div className="space-y-2.5 px-3.5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge level={rec.priorityLevel} />
                    <HazardTypeBadge hazardType={rec.riskAssessment.hazardType} />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {rec.riskAssessment.district.name}
                    </span>
                  </div>

                  <p className="line-clamp-2 text-sm text-muted-foreground">{rec.summaryText}</p>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Predicted impact:{' '}
                      <span className="font-semibold text-foreground tabular-nums">
                        {Math.round(rec.priorityScore)}%
                      </span>
                    </span>
                    <span>
                      Confidence:{' '}
                      <span className="font-semibold text-foreground tabular-nums">
                        {Math.round(rec.confidenceScore * 100)}%
                      </span>
                    </span>
                  </div>

                  <div className="rounded-md bg-primary/5 px-2.5 py-2 text-xs text-foreground">
                    <span className="font-semibold text-primary">Recommended action — </span>
                    {rec.actionRecommendation}
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Review recommendation
                    <ArrowRight className="h-3 w-3 transition-transform group-hover/rec:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
      </CardContent>
    </Card>
  );
}

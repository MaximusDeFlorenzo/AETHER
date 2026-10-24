import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowRight,
  CloudRain,
  Flame,
  Info,
  Layers,
  MapPin,
  Mountain,
  Sparkles,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import { PriorityBadge } from '@/components/shared/priority-badge';
import { hazardTypeToColor } from '@/lib/chart-colors';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { DecisionRecommendation } from '@/types/domain';

interface AiDecisionIntelligenceProps {
  recommendations: DecisionRecommendation[];
  total: number;
  isLoading: boolean;
  /** Cards shown after near-duplicates are merged. */
  maxCards?: number;
}

const MAX_REASONS = 3;

// One glyph per scoring factor the risk engine reports (`reasons[].factor`),
// so the "why" reads at a glance before the sentence does.
const FACTOR_ICONS: Record<string, LucideIcon> = {
  population_density: Users,
  affected_population: Users,
  event_proximity: MapPin,
  water_level: Waves,
  rainfall: CloudRain,
  frp_confidence: Flame,
  soil_saturation: Mountain,
  cascading_hazard: Layers,
};

interface RecommendationGroup {
  rec: DecisionRecommendation;
  similar: number;
}

// The engine re-assesses a district on every new hazard event, so the
// newest page often holds the same district/hazard/priority several times
// (e.g. two hotspots 0.6 km apart). Keep the highest-scored one per key.
function mergeSimilar(recommendations: DecisionRecommendation[]): RecommendationGroup[] {
  const groups = new Map<string, RecommendationGroup>();
  for (const rec of recommendations) {
    const key = `${rec.riskAssessment.district.id}:${rec.riskAssessment.hazardType}:${rec.priorityLevel}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { rec, similar: 0 });
    else {
      group.similar += 1;
      if (rec.priorityScore > group.rec.priorityScore) group.rec = rec;
    }
  }
  return [...groups.values()];
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground tabular-nums">{pct}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function RecommendationCard({ group, featured }: { group: RecommendationGroup; featured: boolean }) {
  const { rec, similar } = group;
  const { hazardType, district, hazardEvent } = rec.riskAssessment;
  const href = hazardEvent?.id ? `/hazards/${hazardEvent.id}` : '/decision-intelligence';
  const hazardColor = hazardTypeToColor(hazardType);
  const reasons = [...(rec.reasons ?? [])].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const shown = reasons.slice(0, featured ? reasons.length : MAX_REASONS);

  return (
    <Link
      href={href}
      className={cn(
        'group/rec flex flex-col gap-3.5 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
        featured && 'sm:col-span-2',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
          style={{ background: hazardColor }}
        >
          <HazardIcon hazardType={hazardType} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base leading-tight font-semibold text-foreground">{district.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {HAZARD_TYPE_LABELS[hazardType]} · {formatDistanceToNow(new Date(rec.createdAt), { addSuffix: true })}
            {similar > 0 && ` · ${similar} similar merged`}
          </p>
        </div>
        <PriorityBadge level={rec.priorityLevel} />
      </div>

      {shown.length > 0 ? (
        <ul className={cn('grid gap-2', featured && 'md:grid-cols-2')}>
          {shown.map((reason) => {
            const Icon = FACTOR_ICONS[reason.factor] ?? Info;
            return (
              <li key={reason.factor} className="flex items-start gap-2 text-sm text-foreground/85">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{reason.detail}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="line-clamp-2 text-sm text-muted-foreground">{rec.summaryText}</p>
      )}
      {reasons.length > shown.length && (
        <p className="-mt-2 pl-6 text-xs text-muted-foreground">+{reasons.length - shown.length} more factor(s)</p>
      )}

      {rec.actionRecommendation && (
        <div className="rounded-lg bg-primary/5 px-3 py-2 text-sm text-foreground">
          <span className="font-semibold text-primary">Recommended action: </span>
          {rec.actionRecommendation}
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-4 border-t border-border pt-3">
        <ScoreBar label="Predicted impact" value={rec.priorityScore} color={hazardColor} />
        <ScoreBar label="Confidence" value={rec.confidenceScore * 100} color="var(--primary)" />
      </div>

      <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
        Review recommendation
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/rec:translate-x-0.5" />
      </span>
    </Link>
  );
}

// The dashboard's clearest signal that AETHER is an *AI* risk-intelligence
// platform, not just a hazard map — surfaces the real
// useDecisionRecommendations data (priorityScore/confidenceScore/reasons
// are all model output, docs/API_SPEC.md §5) rather than inventing a
// separate "AI summary" widget. The top recommendation gets a full-width
// card with every scoring factor; the rest sit two per row.
export function AiDecisionIntelligence({
  recommendations,
  total,
  isLoading,
  maxCards = 5,
}: AiDecisionIntelligenceProps) {
  const groups = mergeSimilar(recommendations).slice(0, maxCards);

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
        <Link
          href="/decision-intelligence"
          className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-cyan tabular-nums transition-colors hover:bg-white/20"
        >
          {total.toLocaleString('en-US')} total · View all
        </Link>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-44 w-full rounded-xl', i === 0 && 'sm:col-span-2')} />
          ))}

        {!isLoading && groups.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground sm:col-span-2">
            No recommendations yet — the AI engine will surface actions here as new risk assessments come in.
          </p>
        )}

        {!isLoading &&
          groups.map((group, i) => <RecommendationCard key={group.rec.id} group={group} featured={i === 0} />)}
      </CardContent>
    </Card>
  );
}

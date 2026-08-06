import { EXPOSURE_LEVEL_COLORS } from '@/lib/chart-colors';
import { EXPOSURE_LEVEL_LABELS } from '@/lib/labels';
import type { ExposureLevel } from '@/types/domain';

// Generalizes ORION's dashboard/severity-distribution.tsx (DamageLevel) to
// the hazard-agnostic ExposureLevel enum.
const EXPOSURE_ORDER: ExposureLevel[] = ['severe', 'high', 'moderate', 'low'];

interface RiskDistributionProps {
  counts: Record<ExposureLevel, number>;
}

export function RiskDistribution({ counts }: RiskDistributionProps) {
  const max = Math.max(1, ...EXPOSURE_ORDER.map((level) => counts[level]));

  return (
    <div className="space-y-3">
      {EXPOSURE_ORDER.map((level) => {
        const count = counts[level];
        const width = count === 0 ? 0 : Math.max(6, Math.round((count / max) * 100));
        return (
          <div key={level} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              {EXPOSURE_LEVEL_LABELS[level]}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full transition-[width]"
                style={{ width: `${width}%`, background: EXPOSURE_LEVEL_COLORS[level] }}
              />
            </span>
            <span className="w-6 shrink-0 text-right font-mono text-xs font-semibold tabular-nums">
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

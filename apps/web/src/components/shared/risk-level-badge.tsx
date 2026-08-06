import { cn } from '@/lib/utils';
import { EXPOSURE_LEVEL_LABELS } from '@/lib/labels';
import type { ExposureLevel } from '@/types/domain';

// Generalizes ORION's MagnitudeBadge/DamageLevelBadge into one badge keyed
// by the hazard-agnostic ExposureLevel enum — per
// docs/MIGRATION_FROM_ORION.md's badge-refactor row. Same escalating-severity
// styling discipline: hue escalates info -> warning -> danger tint -> danger
// solid fill, so "severe" reads as unambiguously more severe than "high"
// rather than just a slightly different shade.
const EXPOSURE_LEVEL_STYLES: Record<ExposureLevel, string> = {
  low: 'bg-info/10 text-info ring-info/25',
  moderate: 'bg-warning/10 text-warning ring-warning/25',
  high: 'bg-danger/10 text-danger ring-danger/25',
  severe: 'bg-danger text-white ring-transparent',
};

export function RiskLevelBadge({ level, className }: { level: ExposureLevel; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
        EXPOSURE_LEVEL_STYLES[level],
        className,
      )}
    >
      {EXPOSURE_LEVEL_LABELS[level]}
    </span>
  );
}

import { Flame, Mountain, Waves, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { HazardType } from '@/types/domain';

// Generalizes ORION's MagnitudeBadge into an icon+color badge keyed by
// HazardType instead of a single hazard's magnitude — per
// docs/MIGRATION_FROM_ORION.md's badge-refactor row.
export const HAZARD_TYPE_ICONS: Record<HazardType, typeof Zap> = {
  earthquake: Zap,
  landslide: Mountain,
  flood: Waves,
  wildfire: Flame,
};

const HAZARD_TYPE_STYLES: Record<HazardType, string> = {
  earthquake: 'bg-info/10 text-info ring-info/25',
  landslide: 'bg-warning/10 text-warning ring-warning/25',
  flood: 'bg-primary/10 text-primary ring-primary/25',
  wildfire: 'bg-danger/10 text-danger ring-danger/25',
};

export function HazardTypeBadge({ hazardType, className }: { hazardType: HazardType; className?: string }) {
  const Icon = HAZARD_TYPE_ICONS[hazardType];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
        HAZARD_TYPE_STYLES[hazardType],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {HAZARD_TYPE_LABELS[hazardType]}
    </span>
  );
}

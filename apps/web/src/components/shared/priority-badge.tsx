import { cn } from '@/lib/utils';
import { PRIORITY_LEVEL_LABELS } from '@/lib/labels';
import type { PriorityLevel } from '@/types/domain';

// Escalates on two axes: hue (success -> warning -> danger) and, for the
// most urgent tier, fill weight (tinted -> solid) so "critical" reads as
// unambiguously more severe than "high" — reused verbatim from ORION, still
// applies unchanged to decision-recommendation PriorityLevel.
const PRIORITY_STYLES: Record<PriorityLevel, string> = {
  low: 'bg-success/10 text-success ring-success/25',
  medium: 'bg-warning/10 text-warning ring-warning/25',
  high: 'bg-danger/10 text-danger ring-danger/25',
  critical: 'bg-danger text-white ring-transparent',
};

export function PriorityBadge({ level }: { level: PriorityLevel }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1',
        PRIORITY_STYLES[level],
      )}
    >
      {PRIORITY_LEVEL_LABELS[level]}
    </span>
  );
}

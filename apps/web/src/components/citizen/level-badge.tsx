import { LEVEL_META, LEVEL_ORDER } from '@/lib/citizen/status';
import type { CitizenLevel } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';

export function LevelBadge({
  level,
  label,
  className,
}: {
  level: CitizenLevel;
  label?: string;
  className?: string;
}) {
  const meta = LEVEL_META[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold',
        meta.soft,
        meta.text,
        className,
      )}
    >
      {label ?? meta.label}
    </span>
  );
}

/** Four-step Normal → Awas scale with the current step emphasised. Always
 * paired with the level's word, so it reads without relying on color. */
export function LevelScale({ level, className }: { level: CitizenLevel; className?: string }) {
  const current = LEVEL_ORDER.indexOf(level);
  return (
    <div
      className={cn('grid grid-cols-4 gap-1.5', className)}
      role="img"
      aria-label={`Tingkat bahaya: ${LEVEL_META[level].label}, level ${current + 1} dari 4`}
    >
      {LEVEL_ORDER.map((step, index) => (
        <div key={step} className="grid justify-items-center gap-1">
          <span
            className={cn(
              'h-2.5 w-full rounded-full transition-all',
              index <= current ? LEVEL_META[step].solid : 'bg-muted dark:bg-white/10',
              index === current && 'scale-y-150',
            )}
          />
          <span
            className={cn(
              'text-[11px] font-extrabold',
              index === current ? LEVEL_META[step].text : 'text-muted-foreground',
            )}
          >
            {LEVEL_META[step].label}
          </span>
        </div>
      ))}
    </div>
  );
}

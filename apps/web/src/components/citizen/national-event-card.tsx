import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';
import type { NationalEvent } from '@/hooks/use-national-events';
import {
  eventFact,
  eventKind,
  eventPlace,
  eventTitle,
  isStrongEvent,
  sourceLabel,
  timeAgo,
  tsunamiPotential,
} from '@/lib/citizen/events';
import { cn } from '@/lib/utils';
import type { HazardType } from '@/types/domain';
import { HazardIcon } from './hazard-icon';

export const HAZARD_TONE: Record<HazardType, string> = {
  earthquake: 'bg-accent text-primary',
  flood: 'bg-lv-siaga-soft text-lv-siaga',
  wildfire: 'bg-lv-awas-soft text-lv-awas',
  landslide: 'bg-lv-waspada-soft text-lv-waspada',
};

// Compact card: a hazard-tinted wash across the top and a matching eyebrow.
const HAZARD_WASH: Record<HazardType, string> = {
  earthquake: 'from-accent',
  flood: 'from-lv-siaga-soft',
  wildfire: 'from-lv-awas-soft',
  landslide: 'from-lv-waspada-soft',
};

const HAZARD_TEXT: Record<HazardType, string> = {
  earthquake: 'text-primary',
  flood: 'text-lv-siaga',
  wildfire: 'text-lv-awas',
  landslide: 'text-lv-waspada',
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold whitespace-nowrap', className)}>
      {children}
    </span>
  );
}

function StatusChips({ item }: { item: NationalEvent }) {
  const tsunami = tsunamiPotential(item.event);
  return (
    <>
      {tsunami === true && <Chip className="bg-lv-awas-soft text-lv-awas">Berpotensi tsunami</Chip>}
      {tsunami === false && <Chip className="bg-lv-normal-soft text-lv-normal">Tidak berpotensi tsunami</Chip>}
      {isStrongEvent(item.event) && tsunami === null && <Chip className="bg-lv-siaga-soft text-lv-siaga">Skala besar</Chip>}
      {item.smokeTowardUser && (
        <Chip className="bg-lv-waspada-soft text-lv-waspada">Asap bisa terbawa ke wilayah Anda</Chip>
      )}
    </>
  );
}

/** Home-page preview: hazard + time up top, the place as the headline, distance in the footer.
 * With `onSelect` the card shows the event on the page's map instead of opening its page. */
function CompactEventCard({
  item,
  onSelect,
  selected = false,
}: {
  item: NationalEvent;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const { event } = item;
  const details = [eventFact(event), sourceLabel(event.source)].filter(Boolean).join(' · ');
  const className = cn(
    'citizen-lift group relative isolate flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border bg-card/90 p-3 text-left sm:gap-3 sm:rounded-3xl sm:p-4 shadow-[0_10px_30px_-20px_rgba(20,33,61,0.35)] hover:border-primary/30',
    selected ? 'border-primary ring-2 ring-primary/30' : 'border-border/60',
  );

  const body = (
    <>
      <span aria-hidden className={cn('absolute inset-x-0 top-0 -z-10 h-16 bg-gradient-to-b to-transparent sm:h-24', HAZARD_WASH[event.hazardType])} />

      <span className="flex items-center gap-3">
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 sm:h-10 sm:w-10 sm:rounded-2xl ring-current/15 transition-transform duration-200 group-hover:scale-110',
            HAZARD_TONE[event.hazardType],
          )}
        >
          <HazardIcon hazardType={event.hazardType} className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
        <span className="grid min-w-0">
          <span className={cn('truncate text-xs font-black tracking-wide uppercase', HAZARD_TEXT[event.hazardType])}>
            {eventKind(event)}
          </span>
          <span className="text-xs font-bold text-muted-foreground">{timeAgo(event.eventTime)}</span>
        </span>
      </span>

      <span className="grid gap-0.5 sm:gap-1">
        <span className="line-clamp-1 text-sm leading-snug font-extrabold sm:line-clamp-2 sm:text-[15px]">{eventPlace(event)}</span>
        {details && <span className="truncate text-xs text-muted-foreground sm:whitespace-normal">{details}</span>}
      </span>

      <span className="flex flex-wrap gap-1.5 empty:hidden">
        <StatusChips item={item} />
      </span>

      <span
        className={cn(
          'mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2 text-xs font-bold sm:pt-3',
          item.proximity.near ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{item.proximity.label}</span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} aria-pressed={selected} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={`/kejadian/${event.id}`} className={className}>
      {body}
    </Link>
  );
}

/** A nationwide event with its "does this affect me" labels. */
export function NationalEventCard({
  item,
  compact = false,
  onSelect,
  selected,
}: {
  item: NationalEvent;
  compact?: boolean;
  /** Compact only: show the event on the page's map instead of linking to it. */
  onSelect?: () => void;
  selected?: boolean;
}) {
  if (compact) return <CompactEventCard item={item} onSelect={onSelect} selected={selected} />;
  const { event } = item;
  const fact = eventFact(event);

  return (
    <Link
      href={`/kejadian/${event.id}`}
      className="citizen-lift group flex items-center gap-3 rounded-3xl border border-border/60 bg-card/90 p-4 hover:border-primary/30"
    >
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-110', HAZARD_TONE[event.hazardType])}>
        <HazardIcon hazardType={event.hazardType} className="h-5 w-5" />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate font-extrabold leading-snug">{eventTitle(event)}</span>
        <span className="text-xs text-muted-foreground">
          {[fact, timeAgo(event.eventTime), sourceLabel(event.source)].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          <StatusChips item={item} />
          <Chip className={item.proximity.near ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground'}>
            {item.proximity.label}
          </Chip>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

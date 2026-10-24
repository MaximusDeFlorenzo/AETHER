'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { NationalEvent } from '@/hooks/use-national-events';
import { useDistricts } from '@/hooks/use-geo';
import { CITIZEN_HAZARD_COLORS } from '@/lib/chart-colors';
import { eventPlace, eventKind } from '@/lib/citizen/events';
import { cn } from '@/lib/utils';

// Same equirectangular frame as the intro map (lng 94.5–141.5, lat 6.5 to -11.5).
const VIEW_W = 1000;
const VIEW_H = 383;
const project = (lng: number, lat: number) => ({
  x: ((lng - 94.5) / 47) * VIEW_W,
  y: ((6.5 - lat) / 18) * VIEW_H,
});

/** Indonesia drawn from the kabupaten/kota reference points, with today's
 * events and the citizen's own area marked on it. */
export function IndonesiaEventMap({
  items,
  userPoint,
  className,
}: {
  items: NationalEvent[];
  /** [lng, lat] of the citizen's district. */
  userPoint: [number, number] | null;
  className?: string;
}) {
  const districts = useDistricts();
  const dots = useMemo(
    () =>
      (districts.data ?? []).flatMap((district) => {
        const point = district.geom?.coordinates;
        return point ? [{ id: district.id, ...project(point[0], point[1]) }] : [];
      }),
    [districts.data],
  );
  const me = userPoint ? project(userPoint[0], userPoint[1]) : null;

  return (
    <svg viewBox={`-12 -12 ${VIEW_W + 24} ${VIEW_H + 24}`} className={cn('h-auto w-full', className)} role="img" aria-label="Peta kejadian bencana di Indonesia hari ini">
      {dots.map((dot) => (
        <circle key={dot.id} cx={dot.x} cy={dot.y} r={4} className="fill-muted-foreground/35" />
      ))}
      {items.map(({ event }) => {
        const { x, y } = project(event.longitude, event.latitude);
        const color = CITIZEN_HAZARD_COLORS[event.hazardType];
        return (
          <Link key={event.id} href={`/kejadian/${event.id}`} aria-label={`${eventKind(event)} · ${eventPlace(event)}`}>
            <circle cx={x} cy={y} r={16} fill={color} opacity={0.18} />
            <circle cx={x} cy={y} r={7} fill={color} className="stroke-card" strokeWidth={2.5} />
            <title>{`${eventKind(event)} · ${eventPlace(event)}`}</title>
          </Link>
        );
      })}
      {me && (
        <g>
          <circle cx={me.x} cy={me.y} r={9} className="fill-primary stroke-card motion-safe:animate-pulse" strokeWidth={3} />
          <text x={me.x + 14} y={me.y + 5} className="fill-foreground" fontSize={14} fontWeight={800}>
            Anda
          </text>
        </g>
      )}
    </svg>
  );
}

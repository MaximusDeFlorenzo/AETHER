'use client';

import { KARHUTLA_STYLES } from './karhutla-utils';
import type { GeoPolygon, KarhutlaForecast } from '@/types/karhutla';

// At the regional zoom that fits a smoke plume, a few-km spread envelope is a
// speck. This inset redraws the observed footprint and every horizon's
// envelope for one cluster at fire scale, in a local equirectangular frame.

const W = 240;
const H = 170;
const PAD = 14;
const SCALE_STEPS_KM = [0.25, 0.5, 1, 2, 5, 10, 20, 50];

type Xy = [number, number];

function outerRings(g: GeoPolygon): number[][][] {
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

export function KarhutlaSpreadInset({ forecast, horizonHours }: { forecast: KarhutlaForecast; horizonHours: number }) {
  const { latitude: lat0, longitude: lon0 } = forecast.location;
  const kmPerDegLon = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const toKm = ([lon, lat]: number[]): Xy => [(lon - lon0) * kmPerDegLon, (lat - lat0) * 110.57];

  const envelopes = (forecast.predicted.spread?.horizons ?? [])
    .filter((h) => h.status === 'ok' && h.envelope)
    .map((h) => ({ hours: h.horizonHours, rings: outerRings(h.envelope!).map((r) => r.map(toKm)) }));
  const footprint = forecast.observed.pixelFootprint
    ? outerRings(forecast.observed.pixelFootprint).map((r) => r.map(toKm))
    : [];
  const hotspots = forecast.observed.hotspots.map((h) => toKm([h.longitude, h.latitude]));

  const all = [...envelopes.flatMap((e) => e.rings.flat()), ...footprint.flat(), ...hotspots];
  if (!envelopes.length || !all.length) {
    return (
      <div className="flex h-full min-h-[140px] items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No spread envelope for this cluster.
      </div>
    );
  }

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanKm = Math.max(maxX - minX, maxY - minY, 0.5);
  const pxPerKm = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 0.5), (H - 2 * PAD) / Math.max(maxY - minY, 0.5));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toPx = ([x, y]: Xy): Xy => [W / 2 + (x - cx) * pxPerKm, H / 2 - (y - cy) * pxPerKm];
  const path = (rings: Xy[][]) =>
    rings.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${toPx(p)[0].toFixed(1)} ${toPx(p)[1].toFixed(1)}`).join(' ') + ' Z').join(' ');

  const scaleKm = [...SCALE_STEPS_KM].reverse().find((s) => s <= spanKm / 3) ?? SCALE_STEPS_KM[0];
  // Draw the largest envelope first so smaller ones stay visible on top.
  const ordered = [...envelopes].sort((a, b) => b.hours - a.hours);

  return (
    <figure className="m-0 space-y-1.5">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold">Spread close-up · cluster #{forecast.rank}</span>
        <span className="text-muted-foreground tabular-nums">{envelopes.map((e) => `+${e.hours}`).join(' / ')} h</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full rounded-lg border border-border bg-muted/40"
        role="img"
        aria-label={`Spread envelopes for cluster ${forecast.rank} at fire scale; +${horizonHours} h highlighted`}
      >
        {ordered.map((e) => {
          const active = e.hours === horizonHours;
          return (
            <path
              key={e.hours}
              d={path(e.rings)}
              fill={KARHUTLA_STYLES.spread}
              fillOpacity={active ? 0.16 : 0.03}
              stroke={KARHUTLA_STYLES.spread}
              strokeOpacity={active ? 1 : 0.45}
              strokeWidth={active ? 1.8 : 1}
              strokeDasharray="4 3"
            />
          );
        })}
        {footprint.length > 0 && (
          <path d={path(footprint)} fill="none" stroke={KARHUTLA_STYLES.footprint} strokeWidth={1.4} />
        )}
        {hotspots.map((p, i) => {
          const [x, y] = toPx(p);
          return <circle key={i} cx={x} cy={y} r={2.2} fill={KARHUTLA_STYLES.hotspot} />;
        })}
        <g transform={`translate(${PAD} ${H - 10})`} className="fill-muted-foreground text-[9px]">
          <rect width={scaleKm * pxPerKm} height={3} className="fill-foreground/70" />
          <text x={scaleKm * pxPerKm + 4} y={4}>
            {scaleKm} km
          </text>
        </g>
      </svg>
    </figure>
  );
}

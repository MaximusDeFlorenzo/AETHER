import type { ExposedPlace, KarhutlaDataQuality, KarhutlaForecast, SmokeLevel } from '@/types/karhutla';

// Observed data is drawn SOLID; model output is drawn DASHED/translucent.
export const KARHUTLA_STYLES = {
  hotspot: '#f97316',
  footprint: '#fb923c',
  spread: '#ef4444',
  smoke: '#e4e4e7',
  smokeStroke: '#52525b',
  wind: '#38bdf8',
};
export const SMOKE_OPACITY: Record<SmokeLevel, number> = { core: 0.5, likely: 0.32, possible: 0.16 };

export type ExposureReason = 'spread' | SmokeLevel;

/**
 * Known places inside the spread envelope or the core/likely smoke classes at
 * one horizon, de-duplicated across clusters. "Possible" smoke is left out on
 * purpose: it is the outermost, least certain class.
 */
export function exposedPlacesAt(
  forecasts: KarhutlaForecast[],
  horizonHours: number,
): Array<{ place: ExposedPlace; reason: ExposureReason }> {
  const byKey = new Map<string, { place: ExposedPlace; reason: ExposureReason }>();
  for (const f of forecasts) {
    const e = f.exposure.find((x) => x.horizonHours === horizonHours);
    if (!e) continue;
    for (const p of e.spread) byKey.set(`${p.source}:${p.id}`, { place: p, reason: 'spread' });
    for (const level of ['core', 'likely'] as const) {
      for (const p of e.smoke[level]) {
        const key = `${p.source}:${p.id}`;
        if (!byKey.has(key)) byKey.set(key, { place: p, reason: level });
      }
    }
  }
  return Array.from(byKey.values());
}

export const FRESHNESS_LABEL: Record<KarhutlaDataQuality['hotspotFreshness'], string> = {
  fresh: 'Fresh',
  aging: 'Aging',
  stale: 'Stale',
};

export const FRESHNESS_STYLES: Record<KarhutlaDataQuality['hotspotFreshness'], string> = {
  fresh: 'border-success/40 text-success',
  aging: 'border-warning/50 text-warning',
  stale: 'border-danger/40 text-danger',
};

export const formatKm = (km: number | null | undefined, digits = 1) =>
  km == null ? '—' : km.toLocaleString(undefined, { maximumFractionDigits: digits });

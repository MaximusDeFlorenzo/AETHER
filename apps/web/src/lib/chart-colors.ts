import type { ExposureLevel, HazardType, PriorityLevel } from '@/types/domain';

/**
 * Literal color values mirroring the design-system tokens in globals.css.
 *
 * Recharts sets `fill`/`stroke` as raw SVG presentation attributes and
 * Leaflet's `pathOptions` are plain JS objects — neither can resolve CSS
 * custom properties (`var(--token)`), so anything drawn on a <canvas>/<svg>
 * needs a literal value here instead of a Tailwind/CSS-var class. Keeping
 * every chart- and map-marker color in this one module (instead of each
 * component hardcoding its own) is what keeps them in sync with the tokens
 * and with each other. Values mirror the BMKG-inspired palette in
 * globals.css: --primary/--info/--success/--warning/--danger.
 */

export const CHART_PRIMARY = '#c2410c';
export const CHART_INFO = '#4f46e5';
export const CHART_SUCCESS = '#16a34a';
export const CHART_WARNING = '#f59e0b';
export const CHART_DANGER = '#dc2626';

export const CHART_GRID = '#e5e7eb';
export const CHART_AXIS = '#64748b';

/** Current-event vs. historical-comparison series (hazard detail page). */
export const CURRENT_EVENT_COLOR = CHART_PRIMARY;
export const HISTORICAL_COLOR = CHART_INFO;

// --- Risk / exposure severity (replaces ORION's magnitude/damage-level
// color scales — the same escalating hue discipline, now keyed by the
// hazard-agnostic ExposureLevel enum). ---------------------------------

export const EXPOSURE_LEVEL_COLORS: Record<ExposureLevel, string> = {
  low: CHART_INFO,
  moderate: CHART_WARNING,
  high: '#dc2626d9',
  severe: CHART_DANGER,
};

export function riskLevelToColor(level: ExposureLevel | null | undefined): string {
  if (!level) return CHART_AXIS;
  return EXPOSURE_LEVEL_COLORS[level];
}

/** Continuous 0-100 risk score fallback, for places without a discretized
 * ExposureLevel yet (e.g. a still-`pending` baseline assessment). */
export function riskScoreToColor(score: number): string {
  if (score >= 75) return EXPOSURE_LEVEL_COLORS.severe;
  if (score >= 50) return EXPOSURE_LEVEL_COLORS.high;
  if (score >= 25) return EXPOSURE_LEVEL_COLORS.moderate;
  return EXPOSURE_LEVEL_COLORS.low;
}

export const PRIORITY_LEVEL_COLORS: Record<PriorityLevel, string> = {
  low: CHART_SUCCESS,
  medium: CHART_WARNING,
  high: '#dc2626d9',
  critical: CHART_DANGER,
};

export function priorityLevelToColor(level: PriorityLevel): string {
  return PRIORITY_LEVEL_COLORS[level];
}

// --- Hazard type identity color (new — ORION only ever had one hazard type,
// so it never needed a type->color mapping; AETHER's map/legend/badges need
// one distinct hue per hazard so markers stay legible when types are mixed
// on the same map). Chosen to be visually distinct from the severity ramp
// above wherever both appear together (e.g. a HazardTypeBadge next to a
// RiskLevelBadge) — deliberately NOT tied to --primary (now a burnt orange),
// since landslide/wildfire already sit in the red-orange region and a 4th
// orange-ish hue would collapse the map legend's distinguishability. --------

export const HAZARD_TYPE_COLORS: Record<HazardType, string> = {
  earthquake: '#2563eb', // blue — kept distinct from the orange brand primary
  landslide: '#b45309', // warm brown/amber — earth movement
  flood: '#4f46e5', // info blue-violet
  wildfire: '#dc2626', // danger red-orange
};

export function hazardTypeToColor(hazardType: HazardType): string {
  return HAZARD_TYPE_COLORS[hazardType];
}

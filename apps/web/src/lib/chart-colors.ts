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
 * and with each other. Values mirror the navy/blue/cyan palette in
 * globals.css: --primary/--info/--success/--warning/--danger.
 */

export const CHART_PRIMARY = '#1976d2';
export const CHART_INFO = '#0891b2';
export const CHART_SUCCESS = '#16a34a';
export const CHART_WARNING = '#f59e0b';
export const CHART_DANGER = '#dc2626';
export const CHART_NAVY = '#102a56';
export const CHART_CYAN = '#43c6d5';

export const CHART_GRID = '#e2e8f0';
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
// RiskLevelBadge) and from --primary (brand blue), since flood would
// otherwise collapse into the same hue as the interactive/active accent. ---

export const HAZARD_TYPE_COLORS: Record<HazardType, string> = {
  earthquake: '#4f46e5', // indigo — kept distinct from brand blue
  landslide: '#b45309', // warm brown/amber — earth movement
  flood: '#0891b2', // cyan-teal — water, ties to the brand's cyan accent
  wildfire: '#dc2626', // danger red-orange
};

export function hazardTypeToColor(hazardType: HazardType): string {
  return HAZARD_TYPE_COLORS[hazardType];
}

// --- Citizen portal map (components/citizen/citizen-map.tsx) -------------
// Mid-tone literals that read on both the light (Carto Voyager) and dark
// (Carto Dark Matter) basemaps; mirror the --lv-* status tokens in
// globals.css.
export const CITIZEN_HAZARD_COLORS: Record<HazardType, string> = {
  earthquake: '#2f7de1',
  flood: '#e0701a',
  wildfire: '#d93030',
  landslide: '#b88600',
};
export const CITIZEN_USER_COLOR = CHART_PRIMARY;
export const CITIZEN_SHELTER_COLOR = '#1c8a4c';
export const CITIZEN_ALARM_COLOR = '#c1121f';
// Smoke plume fill per basemap theme — a warm grey-brown that reads as haze
// on both the light Voyager and dark Dark Matter tiles.
export const CITIZEN_SMOKE_COLORS = { light: '#6f6356', dark: '#d2c6b2' } as const;
export const CITIZEN_FIRE_COLOR = '#e8590c';

// --- Rainfall outlook severity (flood/landslide rule levels). LOW is grey,
// not green: no trigger detected is not an all-clear. ----------------------

export const RAINFALL_SEVERITY_COLORS = {
  NONE: '#cbd5e1',
  LOW: '#94a3b8',
  MEDIUM: CHART_WARNING,
  HIGH: '#ea580c',
  EXTREME: CHART_DANGER,
} as const;

// --- Earthquake magnitude classes (BMKG-style M bands). Minor quakes stay
// grey so the map's attention goes to the felt / damaging ones. ------------

export const EARTHQUAKE_MAGNITUDE_COLORS = {
  MINOR: '#94a3b8',
  LIGHT: CHART_INFO,
  MODERATE: CHART_WARNING,
  STRONG: '#ea580c',
  MAJOR: CHART_DANGER,
} as const;

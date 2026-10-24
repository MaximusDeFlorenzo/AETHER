import leaflet from 'leaflet';
import { hazardTypeToColor } from '@/lib/chart-colors';
import type { HazardType } from '@/types/domain';

// Glyphs drawn inside the analyst map's hazard pins, as raw SVG because
// Leaflet divIcons take an HTML string. Same 24px / round-stroke style as
// lucide (and the citizen map's fire marker); also rendered in the map's
// filter chips and legend so the key matches the markers exactly.
const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

export const HAZARD_GLYPH_SVG: Record<HazardType, string> = {
  wildfire: `${SVG_OPEN}<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z"/></svg>`,
  flood: `${SVG_OPEN}<path d="M2 7c.6.5 1.2 1 2.5 1C7 8 7 6 9.5 6c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12.5c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`,
  landslide: `${SVG_OPEN}<path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,
  earthquake: `${SVG_OPEN}<path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
};

const iconCache = new Map<string, leaflet.DivIcon>();

/** Colored round pin with the hazard's glyph; `size` (px) carries the
 * magnitude cue the old plain circles did, `severe` adds a pulsing ring. */
export function hazardPinIcon(type: HazardType, size: number, severe: boolean): leaflet.DivIcon {
  const key = `${type}:${size}:${severe ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = leaflet.divIcon({
      className: `hazard-pin${severe ? ' is-severe' : ''}`,
      html: `<span style="--pin:${hazardTypeToColor(type)}">${HAZARD_GLYPH_SVG[type]}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

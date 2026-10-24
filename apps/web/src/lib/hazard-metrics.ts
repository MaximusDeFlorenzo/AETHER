import { CloudRain, Droplets, Flame, Gauge, Mountain, Thermometer, type LucideIcon } from 'lucide-react';
import type { EarthquakeDetails, FloodDetails, HazardType, LandslideDetails, WildfireDetails } from '@/types/domain';

export interface HazardDetailMetric {
  icon: LucideIcon;
  label: string;
  value: string;
}

// Per-hazard-type headline metrics, shared by the hazard detail page and the
// evacuation alert dialog so the two never drift on which fields matter most.
export function getHazardDetailMetrics(hazardType: HazardType, details: unknown): HazardDetailMetric[] {
  if (hazardType === 'earthquake') {
    const d = details as EarthquakeDetails | null;
    return [
      { icon: Gauge, label: 'Magnitude', value: `M${d?.magnitude?.toFixed(1) ?? '—'}` },
      { icon: Mountain, label: 'Depth', value: `${d?.depthKm ?? '—'} km` },
    ];
  }
  if (hazardType === 'landslide') {
    const d = details as LandslideDetails | null;
    return [
      { icon: Mountain, label: 'Slope angle', value: d?.slopeDegrees != null ? `${d.slopeDegrees}°` : '—' },
      {
        icon: Gauge,
        label: 'Soil saturation',
        value: d?.soilSaturation != null ? `${Math.round(d.soilSaturation * 100)}%` : '—',
      },
    ];
  }
  if (hazardType === 'flood') {
    const d = details as FloodDetails | null;
    return [
      { icon: Droplets, label: 'Water level', value: d?.waterLevelM != null ? `${d.waterLevelM} m` : '—' },
      { icon: CloudRain, label: 'Rainfall', value: d?.rainfallMm != null ? `${d.rainfallMm} mm` : '—' },
    ];
  }
  if (hazardType === 'wildfire') {
    const d = details as WildfireDetails | null;
    return [
      { icon: Flame, label: 'Hotspots', value: d?.hotspotCount != null ? `${d.hotspotCount}` : '—' },
      {
        icon: Thermometer,
        label: 'FIRMS confidence',
        value: d?.frpConfidence != null ? `${Math.round(d.frpConfidence * 100)}%` : '—',
      },
    ];
  }
  return [];
}

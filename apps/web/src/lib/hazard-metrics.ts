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
    const d = details as EarthquakeDetails;
    return [
      { icon: Gauge, label: 'Magnitude', value: `M${d.magnitude?.toFixed(1) ?? '—'}` },
      { icon: Mountain, label: 'Depth', value: `${d.depthKm ?? '—'} km` },
    ];
  }
  if (hazardType === 'landslide') {
    const d = details as LandslideDetails;
    return [
      { icon: Mountain, label: 'Slope angle', value: d.slopeAngleDeg != null ? `${d.slopeAngleDeg}°` : '—' },
      {
        icon: Gauge,
        label: 'Soil saturation',
        value: d.soilSaturationPct != null ? `${d.soilSaturationPct}%` : '—',
      },
    ];
  }
  if (hazardType === 'flood') {
    const d = details as FloodDetails;
    return [
      { icon: Droplets, label: 'Water level', value: d.waterLevelM != null ? `${d.waterLevelM} m` : '—' },
      { icon: CloudRain, label: 'Rainfall', value: d.rainfallMm != null ? `${d.rainfallMm} mm` : '—' },
    ];
  }
  if (hazardType === 'wildfire') {
    const d = details as WildfireDetails;
    return [
      { icon: Flame, label: 'Hotspots', value: d.hotspotCount != null ? `${d.hotspotCount}` : '—' },
      {
        icon: Thermometer,
        label: 'FIRMS confidence',
        value: d.frpConfidence != null ? `${Math.round(d.frpConfidence * 100)}%` : '—',
      },
    ];
  }
  return [];
}

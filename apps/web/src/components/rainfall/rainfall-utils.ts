import { RAINFALL_SEVERITY_COLORS } from '@/lib/chart-colors';
import type { DistrictOutlook, RainfallSeverity } from '@/types/rainfall';

export const SEVERITIES: RainfallSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];

export const SEVERITY_LABEL: Record<RainfallSeverity, string> = {
  LOW: 'No trigger',
  MEDIUM: 'Medium',
  HIGH: 'High',
  EXTREME: 'Extreme',
};

export function severityColor(severity: RainfallSeverity | null): string {
  return RAINFALL_SEVERITY_COLORS[severity ?? 'NONE'];
}

export const SEVERITY_RANK: Record<RainfallSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXTREME: 3 };

export const atLeast = (d: DistrictOutlook, min: RainfallSeverity) =>
  d.severity !== null && SEVERITY_RANK[d.severity] >= SEVERITY_RANK[min];

export const compass = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

export const formatPopulation = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1_000 ? `${Math.round(n / 1_000)} k` : String(n);

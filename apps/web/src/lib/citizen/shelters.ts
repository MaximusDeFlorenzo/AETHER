import type { Shelter, ShelterKind } from '@/types/domain';

/**
 * The shelters endpoint returns the entity's PostGIS `geom` (GeoJSON point)
 * rather than flat latitude/longitude — accept either so callers get a
 * usable point.
 */
export function shelterLatLng(shelter: Shelter): { lat: number; lng: number } | null {
  const geom = shelter.geom;
  if (geom?.coordinates) return { lat: geom.coordinates[1], lng: geom.coordinates[0] };
  if (typeof shelter.latitude === 'number' && typeof shelter.longitude === 'number') {
    return { lat: shelter.latitude, lng: shelter.longitude };
  }
  return null;
}

export const SHELTER_KIND_LABELS: Record<ShelterKind, string> = {
  posko: 'Posko',
  assembly_point: 'Titik kumpul',
};

// Posko green, titik kumpul blue: they differ in lightness too, not hue alone.
export const SHELTER_KIND_COLORS: Record<ShelterKind, string> = {
  posko: '#15803d',
  assembly_point: '#1d4ed8',
};

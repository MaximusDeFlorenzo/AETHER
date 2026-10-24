import { formatDistanceToNowStrict } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { isHighSeverityHazardEvent } from '@/lib/hazard-severity';
import type {
  EarthquakeDetails,
  FloodDetails,
  HazardEvent,
  LandslideDetails,
  WildfireDetails,
} from '@/types/domain';

const idNumber = (value: number, digits = 1) =>
  value.toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function eventPlace(event: HazardEvent): string {
  return event.locationLabel ?? event.region ?? 'lokasi belum bernama';
}

/** What happened, without the place, e.g. "Gempa M5,8" or "Titik api". */
export function eventKind(event: HazardEvent): string {
  switch (event.hazardType) {
    case 'earthquake': {
      const magnitude = (event.details as EarthquakeDetails | null)?.magnitude;
      return magnitude != null ? `Gempa M${idNumber(magnitude)}` : 'Gempa';
    }
    case 'flood':
      return 'Banjir';
    case 'landslide':
      return 'Potensi longsor';
    case 'wildfire':
      return 'Titik api';
  }
}

/** Plain-language one-line title, e.g. "Gempa M5,8 · Laut Sawu, NTT". */
export function eventTitle(event: HazardEvent): string {
  return `${eventKind(event)} · ${eventPlace(event)}`;
}

/** The one fact a citizen cares about for this hazard, in words. */
export function eventFact(event: HazardEvent): string | null {
  switch (event.hazardType) {
    case 'earthquake': {
      const depthKm = (event.details as EarthquakeDetails | null)?.depthKm;
      return depthKm != null ? `Kedalaman ${idNumber(depthKm, 0)} km` : null;
    }
    case 'flood': {
      const details = event.details as FloodDetails | null;
      if (details?.waterLevelM != null) return `Tinggi air ± ${idNumber(details.waterLevelM)} m`;
      if (details?.rainfallMm != null) return `Hujan ${idNumber(details.rainfallMm, 0)} mm`;
      return null;
    }
    case 'landslide': {
      const details = event.details as LandslideDetails | null;
      if (details?.triggeringRainfallMm != null) return `Hujan 24 jam ${idNumber(details.triggeringRainfallMm, 0)} mm`;
      if (details?.soilSaturation != null) return `Tanah jenuh air ${idNumber(details.soilSaturation * 100, 0)}%`;
      return null;
    }
    case 'wildfire': {
      const details = event.details as WildfireDetails | null;
      return details?.hotspotCount != null ? `${idNumber(details.hotspotCount, 0)} deteksi satelit` : null;
    }
  }
}

export function tsunamiPotential(event: HazardEvent): boolean | null {
  if (event.hazardType !== 'earthquake') return null;
  return (event.details as EarthquakeDetails | null)?.potentialTsunami ?? false;
}

export function isStrongEvent(event: HazardEvent): boolean {
  return isHighSeverityHazardEvent(event);
}

const SOURCE_LABELS: Record<string, string> = {
  bmkg_autogempa: 'BMKG',
  bmkg_gempaterkini: 'BMKG',
  nasa_firms: 'Satelit NASA FIRMS',
  weather_api: 'Data cuaca',
  landslide_rainfall_trigger: 'Curah hujan Open-Meteo',
  petabencana: 'PetaBencana.id',
  manual: 'Petugas',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function timeAgo(isoTime: string): string {
  return formatDistanceToNowStrict(new Date(isoTime), { addSuffix: true, locale: localeId });
}

/** Round to a friendly figure ("± 1.200") — exact counts imply precision
 * a model estimate doesn't have. */
export function roundPopulation(value: number): string {
  const step = value >= 10_000 ? 1_000 : value >= 1_000 ? 100 : 10;
  return (Math.round(value / step) * step).toLocaleString('id-ID');
}

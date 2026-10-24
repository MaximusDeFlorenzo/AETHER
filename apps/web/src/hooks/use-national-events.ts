import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { distanceKm, locationLatLng, proximityLabel, smokeLikelyReaches } from '@/lib/citizen/geo';
import { reachForUser, type WildfireClusterEvent } from '@/lib/citizen/smoke';
import { useHotspotMap } from './use-hotspots';
import { useSmokePlumes } from './use-smoke-plumes';
import type { CitizenLocation, PublicWeather } from '@/lib/citizen/types';
import type { HazardEvent, HazardType, PaginatedResponse } from '@/types/domain';
import type { HotspotCluster } from '@/types/fire';

export interface NationalEvent {
  event: HazardEvent;
  km: number | null;
  proximity: { label: string; near: boolean };
  /** Wildfire only: the fire's 6-hour smoke plume covers the citizen's area. */
  smokeTowardUser: boolean;
}

const SMOKE_LABEL_HOURS = 6;

export const NATIONAL_ORDER: HazardType[] = ['earthquake', 'flood', 'wildfire', 'landslide'];

// Fetched per hazard type, not as one mixed list, so one busy type can't
// push the others out of a newest-first page. Wildfire comes from
// /public/hotspots instead: FIRMS (MODIS + VIIRS) reports 10,000+
// detections a day, served there as clusters.
const PAGED_TYPES: HazardType[] = ['earthquake', 'flood', 'landslide'];
const TYPE_LIMIT = 50;

/** "Kabupaten X, Provinsi" inside Indonesia, the country name outside it. */
export function clusterPlace(cluster: HotspotCluster): string {
  const district = cluster.nearestDistrict;
  const near = district
    ? `${district.distanceKm > 25 ? 'sekitar ' : ''}${district.name}${district.provinceName ? `, ${district.provinceName}` : ''}`
    : null;
  if (cluster.insideIndonesia) return near ?? 'Indonesia';
  if (cluster.country) return `${cluster.country.name} (luar Indonesia)`;
  return near ? `Perairan ${near}` : 'Laut lepas';
}

function clusterEvent(cluster: HotspotCluster): WildfireClusterEvent {
  return {
    id: cluster.id,
    hazardType: 'wildfire',
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    locationLabel: clusterPlace(cluster),
    region: cluster.nearestDistrict?.provinceName ?? cluster.country?.name ?? null,
    eventTime: cluster.latestObservedAt,
    source: 'nasa_firms',
    details: {
      frpConfidence: cluster.confidenceClass === 'high' ? 0.9 : cluster.confidenceClass === 'nominal' ? 0.6 : null,
      hotspotCount: cluster.detections,
      brightnessKelvin: null,
    },
    cluster,
  };
}

/**
 * Every hazard event nationwide in the last `hours`, annotated with how it
 * relates to the citizen ("Dekat wilayah Anda", "asap terbawa ke arah
 * Anda"). The window start is fixed at mount so the query key doesn't
 * change on every render.
 */
export function useNationalEvents(
  location: CitizenLocation | null,
  weather: PublicWeather | null | undefined,
  hours = 24,
) {
  const [from] = useState(() => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString());
  const userPoint = locationLatLng(location);
  const results = useQueries({
    queries: PAGED_TYPES.map((hazardType) => ({
      queryKey: ['hazard-events', { hazardType, from, limit: TYPE_LIMIT }],
      queryFn: async () => {
        const { data } = await apiClient.get<PaginatedResponse<HazardEvent>>('/hazard-events', {
          params: { hazardType, from, limit: TYPE_LIMIT },
        });
        return data;
      },
      refetchInterval: 60_000,
    })),
  });
  const hotspots = useHotspotMap(userPoint);
  const isLoading = results.some((r) => r.isLoading) || hotspots.isLoading;
  const isError = results.every((r) => r.isError) && hotspots.isError;
  const dataKey = results.map((r) => r.dataUpdatedAt).join(',');
  const wildfires = useMemo(() => (hotspots.data?.clusters ?? []).map(clusterEvent), [hotspots.data]);
  const allEvents = useMemo(
    () => [...results.flatMap((r) => r.data?.data ?? []), ...wildfires],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `results` is a new array each render; dataKey tracks real changes
    [dataKey, wildfires],
  );
  const totals = useMemo(() => {
    const map = new Map<HazardType, number>();
    PAGED_TYPES.forEach((type, index) => map.set(type, results[index].data?.meta.total ?? 0));
    // Fire areas (clusters), not raw detections — see `hotspotMap.totals`.
    map.set('wildfire', hotspots.data?.totals.clusters ?? 0);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see allEvents
  }, [dataKey, hotspots.data]);

  // Same 6-hour smoke the smoke map draws, so "asap bisa terbawa ke wilayah
  // Anda" here never disagrees with the map.
  const smoke = useSmokePlumes(wildfires, SMOKE_LABEL_HOURS, userPoint);

  const annotated = useMemo<NationalEvent[]>(() => {
    const user = locationLatLng(location);
    const reachingFireEvents = new Set<string>();
    if (user) {
      for (const plume of smoke.plumes) {
        if (reachForUser(plume, user.lat, user.lng, SMOKE_LABEL_HOURS)) {
          plume.fire.events.forEach((e) => reachingFireEvents.add(e.id));
        }
      }
    }
    return allEvents.map((event) => {
      const km = user ? distanceKm(user.lat, user.lng, event.latitude, event.longitude) : null;
      let smokeTowardUser = reachingFireEvents.has(event.id);
      // Fallback while fire-location wind is unavailable: wind at the
      // citizen's own district blowing from the fire's side.
      if (!smokeTowardUser && event.hazardType === 'wildfire' && user && weather && smoke.plumes.length === 0) {
        smokeTowardUser = smokeLikelyReaches(user.lat, user.lng, event.latitude, event.longitude, weather.windFromDeg);
      }
      return { event, km, proximity: proximityLabel(km), smokeTowardUser };
    });
  }, [allEvents, location, weather, smoke.plumes]);

  const byType = useMemo(() => {
    const groups = new Map<HazardType, NationalEvent[]>();
    for (const type of NATIONAL_ORDER) groups.set(type, []);
    for (const item of annotated) groups.get(item.event.hazardType)?.push(item);
    return groups;
  }, [annotated]);

  return { isLoading, isError, events: annotated, byType, totals, hotspotMap: hotspots.data ?? null };
}

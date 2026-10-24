import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  buildModelPlume,
  buildPlume,
  clusterFires,
  MODEL_SMOKE_MAX_HOURS,
  type FireCluster,
  type PointWind,
  type SmokePlume,
} from '@/lib/citizen/smoke';
import type { HazardEvent } from '@/types/domain';
import type { ModelSmokeForecast } from '@/types/fire';
import { useModelSmoke } from './use-model-smoke';

/**
 * Smoke for every wildfire cluster in `events`, `hours` ahead. Fires the
 * latest karhutla run modelled (its biggest clusters) get the particle
 * model's footprint; the rest drift with the forecast wind AT EACH FIRE
 * (one batched request to /public/wind). A stale run (> 6 h) is ignored,
 * and so is the model past its 12 h horizon: every fire then drifts.
 * Clusters whose wind lookup failed are simply not drawn.
 */
export function useSmokePlumes(events: HazardEvent[], hours: number, user: { lat: number; lng: number } | null = null) {
  const clusters = useMemo(() => clusterFires(events), [events]);
  const useModel = hours <= MODEL_SMOKE_MAX_HOURS;
  const modelSmoke = useModelSmoke(hours, user, useModel);
  const run = useModel ? modelSmoke.data?.run : undefined;

  // Model forecasts per fire cluster (matched through the hotspot cluster
  // ids the fire area is made of), plus modelled fires not on the list.
  const { modelled, orphans } = useMemo(() => {
    const byFire = new Map<string, ModelSmokeForecast[]>();
    const unmatched: ModelSmokeForecast[] = [];
    if (run && !run.stale) {
      for (const forecast of modelSmoke.data?.forecasts ?? []) {
        if (!forecast.horizon) continue;
        const fire = clusters.find((c) => c.events.some((e) => e.id === forecast.clusterId));
        if (fire) byFire.set(fire.id, [...(byFire.get(fire.id) ?? []), forecast]);
        else unmatched.push(forecast);
      }
    }
    return { modelled: byFire, orphans: unmatched };
  }, [clusters, modelSmoke.data, run]);

  const simpleClusters = useMemo(() => clusters.filter((c) => !modelled.has(c.id)), [clusters, modelled]);
  const pointsParam = simpleClusters.map((c) => `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`).join(';');

  const wind = useQuery({
    queryKey: ['public-wind', pointsParam],
    queryFn: async () => {
      const { data } = await apiClient.get<Array<PointWind | null>>('/public/wind', {
        params: { points: pointsParam },
      });
      return data;
    },
    enabled: simpleClusters.length > 0,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const plumes = useMemo<SmokePlume[]>(() => {
    const now = new Date();
    const result: SmokePlume[] = [];
    for (const cluster of clusters) {
      const forecasts = modelled.get(cluster.id);
      if (forecasts && run) {
        result.push(buildModelPlume(cluster, forecasts, run.issuedAt, now));
        continue;
      }
      const index = simpleClusters.indexOf(cluster);
      const w = wind.data?.[index];
      if (w) result.push(buildPlume(cluster, w, hours));
    }
    for (const forecast of orphans) {
      const fire: FireCluster = {
        id: forecast.clusterId ?? forecast.id,
        lat: forecast.latitude,
        lng: forecast.longitude,
        hotspotCount: 0,
        label: forecast.nearestDistrictName ?? 'Lokasi titik api',
        events: [],
        sensors: [],
        co2TonnesPerHour: null,
      };
      result.push(buildModelPlume(fire, [forecast], run!.issuedAt, now));
    }
    return result;
  }, [clusters, modelled, orphans, simpleClusters, wind.data, hours, run]);

  return {
    clusters,
    plumes,
    modelRun: run ?? null,
    isLoading: wind.isLoading || (useModel && modelSmoke.isLoading),
    isError: wind.isError && modelled.size === 0,
  };
}

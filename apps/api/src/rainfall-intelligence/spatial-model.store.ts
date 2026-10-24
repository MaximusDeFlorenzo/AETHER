import { Repository } from 'typeorm';
import { RainfallModelRun } from '../database/entities';
import type {
  SpatialHorizonModel,
  SpatialModelSpec,
} from './rainfall-engine.client';

export const SPATIAL_NOWCAST_TASK = 'rain_nowcast_spatial';

/**
 * The model a live nowcast may use: the promoted horizons of the NEWEST
 * completed training run. A newer run that fails the gate withdraws an
 * older promotion — the latest evaluation on the latest data decides.
 */
export async function loadPromotedSpatialModel(
  repository: Repository<RainfallModelRun>,
): Promise<{ runId: string; spec: SpatialModelSpec } | null> {
  const run = await repository.findOne({
    where: { task: SPATIAL_NOWCAST_TASK, status: 'completed' },
    order: { issuedAt: 'DESC' },
  });
  if (!run || !run.promotedHorizons.length || !run.modelVersion) return null;
  const horizons: SpatialModelSpec['horizons'] = {};
  for (const model of (run.results ?? []) as SpatialHorizonModel[]) {
    if (
      model.promoted &&
      model.coefficients !== null &&
      model.intercept !== null
    ) {
      horizons[String(model.horizonHours)] = {
        coefficients: model.coefficients,
        intercept: model.intercept,
      };
    }
  }
  if (!Object.keys(horizons).length) return null;
  return {
    runId: run.id,
    spec: {
      modelVersion: run.modelVersion,
      trainedAt: run.issuedAt.toISOString(),
      featureNames: (run.parameters.featureNames as string[]) ?? [],
      horizons,
    },
  };
}

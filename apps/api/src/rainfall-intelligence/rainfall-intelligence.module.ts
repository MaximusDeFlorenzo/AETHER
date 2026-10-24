import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DataSourceSync,
  DisasterEventLabel,
  District,
  DistrictHazardIndex,
  DistrictTerrainProfile,
  HazardEvent,
  PopulationStatistic,
  RainfallGrid,
  RainfallModelRun,
  RainfallNowcastRun,
  RainfallPointArchive,
  RainfallRiskRun,
  WeatherHourlySample,
} from '../database/entities';
import { AuditModule } from '../audit/audit.module';
import { DataSourceSyncService } from '../ingestion/data-source-sync.service';
import { RainfallController } from './rainfall.controller';
import { RainfallConditionsService } from './rainfall-conditions.service';
import { RainfallIngestionService } from './rainfall-ingestion.service';
import { RainfallIngestionScheduler } from './rainfall-ingestion.scheduler';
import { GsmapIngestionService } from './gsmap-ingestion.service';
import { RainfallIngestionStatusService } from './rainfall-ingestion-status.service';
import { GsmapFtpProvider } from './providers/gsmap-ftp.provider';
import { RainfallEngineClient } from './rainfall-engine.client';
import { RainfallNowcastService } from './rainfall-nowcast.service';
import { RainfallBacktestService } from './rainfall-backtest.service';
import { BnpbInariskClient } from '../ingestion/adapters/bnpb-inarisk.client';
import { DistrictHazardIndexService } from './district-hazard-index.service';
import { RainfallFloodRiskService } from './rainfall-flood-risk.service';
import { DistrictTerrainService } from './district-terrain.service';
import { RainfallLandslideRiskService } from './rainfall-landslide-risk.service';
import { RainfallSpatialModelService } from './rainfall-spatial-model.service';
import { RainfallOutlookService } from './rainfall-outlook.service';
import { DibiClient } from './providers/dibi.client';
import { DisasterLabelsService } from './disaster-labels.service';
import { GsmapArchiveService } from './gsmap-archive.service';
import { RainfallHazardBacktestService } from './rainfall-hazard-backtest.service';

/**
 * Rainfall Intelligence (docs/RAINFALL_INTELLIGENCE.md). Milestone 1:
 * hourly weather (Open-Meteo) and satellite rainfall (JAXA GSMaP_NOW)
 * ingestion into `weather_hourly_samples` + rainfall/wind features and
 * data-quality over the stored history. API process only —
 * the scheduler runs in-process like IngestionScheduler, so WorkerModule
 * doesn't import this.
 *
 * Milestone 3 adds flood-risk runs over the stored data, with InaRISK
 * flood susceptibility sampled into `district_hazard_indices`. Milestone 4
 * adds landslide-risk runs, with DEM slope sampled into
 * `district_terrain_profiles`. Milestone 5 adds the gated Stage-2 spatial
 * nowcast model, trained daily into `rainfall_model_runs`. Milestone 6 adds
 * the district outlook with rule-based recommendations, read from the
 * latest stored runs. Milestone 7 adds the hazard backtest: BNPB DIBI
 * reports as labels (`disaster_event_labels`), archived GSMaP_Gauge hourly
 * rainfall per district (`rainfall_point_archive`), and backtest runs in
 * `rainfall_model_runs`.
 *
 * DataSourceSyncService and BnpbInariskClient are provided here directly (both are
 * stateless) rather than exported
 * from IngestionModule, which would drag in its adapters and schedulers.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      District,
      WeatherHourlySample,
      DataSourceSync,
      RainfallGrid,
      RainfallModelRun,
      RainfallNowcastRun,
      RainfallRiskRun,
      DistrictHazardIndex,
      DistrictTerrainProfile,
      HazardEvent,
      PopulationStatistic,
      DisasterEventLabel,
      RainfallPointArchive,
    ]),
    HttpModule,
    AuditModule,
  ],
  controllers: [RainfallController],
  providers: [
    DataSourceSyncService,
    RainfallIngestionService,
    RainfallConditionsService,
    RainfallIngestionScheduler,
    GsmapFtpProvider,
    GsmapIngestionService,
    RainfallIngestionStatusService,
    RainfallEngineClient,
    RainfallNowcastService,
    RainfallBacktestService,
    BnpbInariskClient,
    DistrictHazardIndexService,
    RainfallFloodRiskService,
    DistrictTerrainService,
    RainfallLandslideRiskService,
    RainfallSpatialModelService,
    RainfallOutlookService,
    DibiClient,
    DisasterLabelsService,
    GsmapArchiveService,
    RainfallHazardBacktestService,
  ],
})
export class RainfallIntelligenceModule {}

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { RainfallConditionsService } from './rainfall-conditions.service';
import { RainfallIngestionService } from './rainfall-ingestion.service';
import { GsmapIngestionService } from './gsmap-ingestion.service';
import { RainfallIngestionStatusService } from './rainfall-ingestion-status.service';
import { RainfallNowcastService } from './rainfall-nowcast.service';
import { RainfallBacktestService } from './rainfall-backtest.service';
import { RunNowcastBacktestDto } from './dto/run-nowcast-backtest.dto';
import { RainfallFloodRiskService } from './rainfall-flood-risk.service';
import { DistrictHazardIndexService } from './district-hazard-index.service';
import { RainfallLandslideRiskService } from './rainfall-landslide-risk.service';
import { DistrictTerrainService } from './district-terrain.service';
import { RainfallSpatialModelService } from './rainfall-spatial-model.service';
import { RainfallOutlookService } from './rainfall-outlook.service';
import { QueryRainfallOutlookDto } from './dto/query-rainfall-outlook.dto';
import { DisasterLabelsService } from './disaster-labels.service';
import { GsmapArchiveService } from './gsmap-archive.service';
import { RainfallHazardBacktestService } from './rainfall-hazard-backtest.service';

// Authenticated workspace only, like karhutla/predictions: model-derived
// values for trained operators, not yet the citizen portal. Any signed-in
// role may read; only admins and agency operators may spend provider quota
// on a manual ingestion run.
@ApiTags('rainfall')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rainfall')
export class RainfallController {
  constructor(
    private readonly conditions: RainfallConditionsService,
    private readonly ingestion: RainfallIngestionService,
    private readonly gsmap: GsmapIngestionService,
    private readonly ingestionStatus: RainfallIngestionStatusService,
    private readonly nowcast: RainfallNowcastService,
    private readonly backtest: RainfallBacktestService,
    private readonly floodRisk: RainfallFloodRiskService,
    private readonly hazardIndex: DistrictHazardIndexService,
    private readonly landslideRisk: RainfallLandslideRiskService,
    private readonly terrain: DistrictTerrainService,
    private readonly spatialModel: RainfallSpatialModelService,
    private readonly outlookService: RainfallOutlookService,
    private readonly labels: DisasterLabelsService,
    private readonly archive: GsmapArchiveService,
    private readonly hazardBacktest: RainfallHazardBacktestService,
    private readonly auditService: AuditService,
  ) {}

  @Get('conditions')
  listConditions() {
    return this.conditions.listConditions();
  }

  @Get('conditions/:districtId')
  getConditions(@Param('districtId', ParseUUIDPipe) districtId: string) {
    return this.conditions.getConditions(districtId);
  }

  @Post('ingestion/runs')
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runIngestion(@CurrentUser() actor: AuthenticatedUser) {
    const summary = await this.ingestion.ingest();
    if (!summary) {
      throw new ConflictException('A rainfall ingestion run is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.ingestion.run',
      targetType: 'weather_hourly_samples',
      metadata: { ...summary },
    });
    return summary;
  }

  @Get('ingestion/status')
  getIngestionStatus() {
    return this.ingestionStatus.getStatus();
  }

  // 202: a first GSMaP run downloads ~48 files from a slow FTP server, so
  // it runs in the background; poll GET ingestion/status for the result.
  @Post('ingestion/gsmap-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runGsmapIngestion(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.gsmap.isConfigured()) {
      throw new ConflictException(
        'GSMaP FTP credentials are not configured (GSMAP_FTP_USER/GSMAP_FTP_PASSWORD)',
      );
    }
    if (!this.gsmap.startInBackground()) {
      throw new ConflictException('A GSMaP ingestion run is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.gsmap_ingestion.start',
      targetType: 'weather_hourly_samples',
    });
    return { accepted: true };
  }

  @Get('nowcast/latest')
  latestNowcast() {
    return this.nowcast.latest();
  }

  @Get('nowcast/latest/:districtId')
  latestNowcastForDistrict(
    @Param('districtId', ParseUUIDPipe) districtId: string,
  ) {
    return this.nowcast.latest(districtId);
  }

  @Post('nowcast/runs')
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runNowcast(@CurrentUser() actor: AuthenticatedUser) {
    const run = await this.nowcast.run('manual');
    if (!run) {
      throw new ConflictException('A rain nowcast run is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.nowcast.run',
      targetType: 'rainfall_nowcast_run',
      targetId: run.id,
      metadata: { status: run.status },
    });
    return run;
  }

  @Get('nowcast/backtests/latest')
  latestBacktest() {
    return {
      running: this.backtest.isRunning(),
      result: this.backtest.getLast(),
    };
  }

  // 202: ~20 engine calls for a 24 h window; poll nowcast/backtests/latest.
  @Post('nowcast/backtests')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runBacktest(
    @Body() dto: RunNowcastBacktestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!this.backtest.startInBackground(dto.hours)) {
      throw new ConflictException('A nowcast backtest is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.nowcast.backtest',
      targetType: 'rainfall_nowcast_run',
      metadata: { hours: dto.hours },
    });
    return { accepted: true, hours: dto.hours };
  }

  // Decision support: latest nowcast + flood + landslide per district,
  // population as exposure context, rule-based recommendations.
  @Get('outlook')
  outlook(@Query() query: QueryRainfallOutlookDto) {
    return this.outlookService.outlook({
      minSeverity: query.minSeverity,
      compact: query.compact,
    });
  }

  @Get('outlook/:districtId')
  outlookForDistrict(@Param('districtId', ParseUUIDPipe) districtId: string) {
    return this.outlookService.outlook({ districtId });
  }

  @Get('labels/summary')
  labelSummary() {
    return this.labels.summary();
  }

  // 202: one DIBI request per year (full import when the table is empty,
  // else the current and previous year).
  @Post('labels/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async importLabels(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.labels.startInBackground()) {
      throw new ConflictException('A label import is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.labels.import',
      targetType: 'disaster_event_label',
    });
    return { accepted: true };
  }

  @Get('archive/status')
  archiveStatus() {
    return this.archive.status();
  }

  // 202: adds up to GSMAP_ARCHIVE_DAYS_PER_RUN missing days (~1 min each);
  // the bulk backfill is the CLI (npm run rainfall:archive).
  @Post('archive/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async extendArchive(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.archive.startInBackground()) {
      throw new ConflictException(
        'An archive backfill is in progress, or GSMaP FTP is not configured',
      );
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.archive.backfill',
      targetType: 'rainfall_point_archive',
    });
    return { accepted: true };
  }

  @Get('backtest/hazard/latest')
  latestHazardBacktest() {
    return this.hazardBacktest.latest();
  }

  // 202: replays the whole archive through ai-engine month by month, then
  // scores it (~1–3 min for two years).
  @Post('backtest/hazard/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runHazardBacktest(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.hazardBacktest.startInBackground('manual')) {
      throw new ConflictException('A hazard backtest is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.hazard_backtest.run',
      targetType: 'rainfall_model_run',
    });
    return { accepted: true };
  }

  @Get('nowcast/spatial-model/latest')
  latestSpatialModel() {
    return this.spatialModel.latest();
  }

  // 202: replays every stored hour of the last 28 days through the nowcast
  // engine (~1–2 s per hour), then fits and evaluates in ai-engine.
  @Post('nowcast/spatial-model/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async trainSpatialModel(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.spatialModel.startInBackground('manual')) {
      throw new ConflictException(
        'A spatial model training run is in progress',
      );
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.spatial_model.train',
      targetType: 'rainfall_model_run',
    });
    return { accepted: true };
  }

  @Get('flood-risk/latest')
  latestFloodRisk() {
    return this.floodRisk.latest();
  }

  @Get('flood-risk/latest/:districtId')
  latestFloodRiskForDistrict(
    @Param('districtId', ParseUUIDPipe) districtId: string,
  ) {
    return this.floodRisk.latest(districtId);
  }

  @Post('flood-risk/runs')
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runFloodRisk(@CurrentUser() actor: AuthenticatedUser) {
    const run = await this.floodRisk.run('manual');
    if (!run) {
      throw new ConflictException('A flood risk run is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.flood_risk.run',
      targetType: 'rainfall_risk_run',
      targetId: run.id,
      metadata: { status: run.status },
    });
    return run;
  }

  // 202: a full refresh is 514 × 5 InaRISK lookups (~1–2 min); districts
  // sampled in the last 30 days are skipped.
  @Post('hazard-indices/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async refreshHazardIndices(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.hazardIndex.startInBackground()) {
      throw new ConflictException('A hazard index refresh is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.hazard_indices.refresh',
      targetType: 'district_hazard_indices',
    });
    return { accepted: true };
  }

  @Get('landslide-risk/latest')
  latestLandslideRisk() {
    return this.landslideRisk.latest();
  }

  @Get('landslide-risk/latest/:districtId')
  latestLandslideRiskForDistrict(
    @Param('districtId', ParseUUIDPipe) districtId: string,
  ) {
    return this.landslideRisk.latest(districtId);
  }

  @Post('landslide-risk/runs')
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async runLandslideRisk(@CurrentUser() actor: AuthenticatedUser) {
    const run = await this.landslideRisk.run('manual');
    if (!run) {
      throw new ConflictException('A landslide risk run is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.landslide_risk.run',
      targetType: 'rainfall_risk_run',
      targetId: run.id,
      metadata: { status: run.status },
    });
    return run;
  }

  // 202: samples DEM slope for districts without a profile, capped by
  // TERRAIN_SAMPLING_DISTRICTS_PER_DAY over a rolling 24 h (Open-Meteo
  // quota is shared with rainfall ingestion).
  @Post('terrain/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  async refreshTerrain(@CurrentUser() actor: AuthenticatedUser) {
    if (!this.terrain.startInBackground()) {
      throw new ConflictException('A terrain refresh is in progress');
    }
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'rainfall.terrain.refresh',
      targetType: 'district_terrain_profiles',
    });
    return { accepted: true };
  }
}

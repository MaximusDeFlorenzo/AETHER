import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { AuditModule } from './audit/audit.module';
import { GeoModule } from './geo/geo.module';
import { HistoricalModule } from './historical/historical.module';
import { VulnerabilityIndicatorsModule } from './vulnerability-indicators/vulnerability-indicators.module';
import { HazardEventsModule } from './hazard-events/hazard-events.module';
import { FieldReportsModule } from './field-reports/field-reports.module';
import { GroundReportsModule } from './ground-reports/ground-reports.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RiskEngineOrchestrationModule } from './risk-engine-orchestration/risk-engine-orchestration.module';
import { RiskAssessmentsModule } from './risk-assessments/risk-assessments.module';
import { DecisionIntelligenceModule } from './decision-intelligence/decision-intelligence.module';
import { SpatialIntelligenceModule } from './spatial-intelligence/spatial-intelligence.module';
import { ResourceOptimizationModule } from './resource-optimization/resource-optimization.module';
import { SustainabilityModule } from './sustainability/sustainability.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebsocketModule } from './websocket/websocket.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { VillagePopulationImportModule } from './village-population-import/village-population-import.module';
import { PublicAlertsModule } from './public-alerts/public-alerts.module';
import { PublicFireModule } from './public-fire/public-fire.module';
import { RegionalStatusModule } from './regional-status/regional-status.module';
import { KarhutlaPredictionModule } from './karhutla-prediction/karhutla-prediction.module';
import { RainfallIntelligenceModule } from './rainfall-intelligence/rainfall-intelligence.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    GeoModule,
    HistoricalModule,
    VulnerabilityIndicatorsModule,
    SpatialIntelligenceModule,
    IngestionModule,
    HazardEventsModule,
    FieldReportsModule,
    GroundReportsModule,
    RiskEngineOrchestrationModule,
    RiskAssessmentsModule,
    DecisionIntelligenceModule,
    ResourceOptimizationModule,
    SustainabilityModule,
    NotificationsModule,
    WebsocketModule,
    DashboardModule,
    VillagePopulationImportModule,
    PublicAlertsModule,
    PublicFireModule,
    RegionalStatusModule,
    KarhutlaPredictionModule,
    RainfallIntelligenceModule,
  ],
})
export class AppModule {}

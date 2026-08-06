import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { AuditModule } from './audit/audit.module';
import { GeoModule } from './geo/geo.module';
import { HistoricalModule } from './historical/historical.module';
import { HazardEventsModule } from './hazard-events/hazard-events.module';
import { FieldReportsModule } from './field-reports/field-reports.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    RedisModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuditModule,
    GeoModule,
    HistoricalModule,
    SpatialIntelligenceModule,
    IngestionModule,
    HazardEventsModule,
    FieldReportsModule,
    RiskEngineOrchestrationModule,
    RiskAssessmentsModule,
    DecisionIntelligenceModule,
    ResourceOptimizationModule,
    SustainabilityModule,
    NotificationsModule,
    WebsocketModule,
    DashboardModule,
  ],
})
export class AppModule {}

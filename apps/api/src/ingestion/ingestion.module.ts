import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceSync, District } from '../database/entities';
import { HazardEventsModule } from '../hazard-events/hazard-events.module';
import { BmkgAdapter } from './adapters/bmkg.adapter';
import { NasaFirmsAdapter } from './adapters/nasa-firms.adapter';
import { WeatherAdapter } from './adapters/weather.adapter';
import { PetaBencanaAdapter } from './adapters/petabencana.adapter';
import { BnpbInariskClient } from './adapters/bnpb-inarisk.client';
import { OpenMeteoClient } from './adapters/open-meteo.client';
import { LandslideRainfallTriggerAdapter } from './adapters/landslide-rainfall-trigger.adapter';
import { SentinelAdapter } from './adapters/sentinel.adapter';
import { DataSourceSyncService } from './data-source-sync.service';
import { IngestionRegistryService } from './ingestion-registry.service';
import { IngestionScheduler } from './ingestion.scheduler';
import { HAZARD_DATA_SOURCE_ADAPTERS } from './ingestion.constants';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([DataSourceSync, District]),
    // Circular: HazardEventsModule triggers ingestion's registry (manual
    // sync), while the registry calls back into HazardEventsService to
    // persist what an adapter fetches.
    forwardRef(() => HazardEventsModule),
  ],
  providers: [
    BmkgAdapter,
    NasaFirmsAdapter,
    WeatherAdapter,
    PetaBencanaAdapter,
    BnpbInariskClient,
    OpenMeteoClient,
    LandslideRainfallTriggerAdapter,
    SentinelAdapter,
    DataSourceSyncService,
    IngestionRegistryService,
    IngestionScheduler,
    {
      provide: HAZARD_DATA_SOURCE_ADAPTERS,
      useFactory: (
        bmkgAdapter: BmkgAdapter,
        nasaFirmsAdapter: NasaFirmsAdapter,
        weatherAdapter: WeatherAdapter,
        petaBencanaAdapter: PetaBencanaAdapter,
        landslideRainfallTriggerAdapter: LandslideRainfallTriggerAdapter,
        sentinelAdapter: SentinelAdapter,
      ) => [
        bmkgAdapter,
        nasaFirmsAdapter,
        weatherAdapter,
        petaBencanaAdapter,
        landslideRainfallTriggerAdapter,
        sentinelAdapter,
      ],
      inject: [
        BmkgAdapter,
        NasaFirmsAdapter,
        WeatherAdapter,
        PetaBencanaAdapter,
        LandslideRainfallTriggerAdapter,
        SentinelAdapter,
      ],
    },
  ],
  exports: [IngestionRegistryService],
})
export class IngestionModule {}

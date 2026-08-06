import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HazardEventsModule } from '../hazard-events/hazard-events.module';
import { HazardEventsGateway } from './hazard-events.gateway';
import { DashboardGateway } from './dashboard.gateway';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [AuthModule, HazardEventsModule],
  providers: [HazardEventsGateway, DashboardGateway, NotificationsGateway],
})
export class WebsocketModule {}

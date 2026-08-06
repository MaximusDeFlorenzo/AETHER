import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { DomainEvents } from '../common/events/domain-events';
import type {
  HazardEventCreatedEvent,
  HazardRelationshipDetectedEvent,
} from '../common/events/domain-events';
import { HazardEventsService } from '../hazard-events/hazard-events.service';
import { authenticateSocket } from './ws-auth.util';
import type { AuthenticatedSocket } from './authenticated-socket.type';

// Public feed — same posture as `GET /hazard-events`. A valid token attaches
// `socket.data.user` for future role-scoped use, but anonymous public
// dashboard viewers stay connected and receive the same broadcasts.
@WebSocketGateway({ namespace: '/ws/hazard-events', cors: { origin: '*' } })
export class HazardEventsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(HazardEventsGateway.name);

  constructor(
    private readonly hazardEventsService: HazardEventsService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(@ConnectedSocket() socket: AuthenticatedSocket) {
    const payload = authenticateSocket(socket, this.jwtService, this.config);
    if (payload) {
      socket.data.user = payload;
    }
  }

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async handleHazardEventCreated(event: HazardEventCreatedEvent): Promise<void> {
    try {
      const hazardEvent = await this.hazardEventsService.findOne(
        event.hazardEventId,
      );
      this.server?.emit('hazard_event.created', hazardEvent);
    } catch (error) {
      this.logger.warn(
        `Failed to broadcast hazard_event.created: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent(DomainEvents.HAZARD_RELATIONSHIP_DETECTED, { async: true })
  handleHazardRelationshipDetected(
    event: HazardRelationshipDetectedEvent,
  ): void {
    this.server?.emit('hazard_relationship.detected', event);
  }
}

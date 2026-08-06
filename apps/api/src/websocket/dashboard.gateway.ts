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
import { authenticateSocket } from './ws-auth.util';
import type { AuthenticatedSocket } from './authenticated-socket.type';

@WebSocketGateway({ namespace: '/ws/dashboard', cors: { origin: '*' } })
export class DashboardGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Public feed — same posture as `GET /dashboard`. A valid token attaches
  // `socket.data.user` for future role-scoped use, but anonymous public
  // dashboard viewers stay connected and receive the same broadcasts.
  handleConnection(@ConnectedSocket() socket: AuthenticatedSocket) {
    const payload = authenticateSocket(socket, this.jwtService, this.config);
    if (payload) {
      socket.data.user = payload;
    }
  }

  // Emits a lightweight "something changed" marker rather than duplicating
  // GET /dashboard's aggregation here — the frontend refetches on receipt.
  // Keeps this gateway decoupled from DashboardModule (no reverse dependency).
  @OnEvent(
    [
      DomainEvents.HAZARD_EVENT_CREATED,
      DomainEvents.RISK_ASSESSMENT_COMPLETED,
      DomainEvents.DECISION_RECOMMENDATION_CREATED,
    ],
    { async: true },
  )
  handleDashboardRelevantEvent(): void {
    this.server?.emit('dashboard.summary.updated', {
      updatedAt: new Date().toISOString(),
    });
  }
}

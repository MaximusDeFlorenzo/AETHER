import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type Redis from 'ioredis';
import type { Server } from 'socket.io';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { NOTIFICATIONS_REDIS_CHANNEL } from '../notifications/notifications.constants';
import { authenticateSocket } from './ws-auth.util';
import type { AuthenticatedSocket } from './authenticated-socket.type';

interface BroadcastNotification {
  user?: { id?: string } | null;
}

@WebSocketGateway({ namespace: '/ws/notifications', cors: { origin: '*' } })
export class NotificationsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private subscriber: Redis;
  private readonly socketsByUserId = new Map<string, Set<string>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(NOTIFICATIONS_REDIS_CHANNEL);
    this.subscriber.on('message', (_channel, message) =>
      this.broadcast(message),
    );
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }

  // Public feed — broadcast notifications (`user: null`, e.g. new-hazard-
  // event alerts) go to every connected client, authenticated or not, same
  // as the public `GET /notifications` posture. Only per-user-targeted
  // notifications need `socketsByUserId`, which anonymous sockets simply
  // never join.
  handleConnection(@ConnectedSocket() socket: AuthenticatedSocket) {
    const payload = authenticateSocket(socket, this.jwtService, this.config);
    if (!payload) {
      return;
    }
    socket.data.user = payload;

    const sockets = this.socketsByUserId.get(payload.sub) ?? new Set<string>();
    sockets.add(socket.id);
    this.socketsByUserId.set(payload.sub, sockets);
  }

  handleDisconnect(@ConnectedSocket() socket: AuthenticatedSocket) {
    const userId = socket.data.user?.sub;
    if (userId) {
      this.socketsByUserId.get(userId)?.delete(socket.id);
    }
  }

  private broadcast(message: string): void {
    if (!this.server) {
      return;
    }

    let notification: BroadcastNotification;
    try {
      notification = JSON.parse(message) as BroadcastNotification;
    } catch (error) {
      this.logger.warn(
        `Discarding malformed notification message: ${(error as Error).message}`,
      );
      return;
    }

    const targetUserId = notification.user?.id;
    if (!targetUserId) {
      this.server.emit('notification.created', notification);
      return;
    }

    const socketIds = this.socketsByUserId.get(targetUserId);
    socketIds?.forEach((socketId) =>
      this.server.to(socketId).emit('notification.created', notification),
    );
  }
}

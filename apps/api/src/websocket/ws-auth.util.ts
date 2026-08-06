import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import type { JwtPayload } from '../auth/types/authenticated-user.type';

/**
 * Validates the JWT once at handshake time (docs/API_SPEC.md's auth guard
 * posture) rather than per-message — cheap enough for this deployment's
 * connection volume, and keeps the gateways simple. Returns the payload on
 * success or null (caller should treat the socket as anonymous/public).
 */
export function authenticateSocket(
  socket: Socket,
  jwtService: JwtService,
  config: ConfigService,
): JwtPayload | null {
  const token =
    (socket.handshake.auth?.token as string | undefined) ??
    (socket.handshake.query?.token as string | undefined) ??
    socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return null;
  }

  try {
    return jwtService.verify<JwtPayload>(token, {
      secret: config.get<string>('JWT_ACCESS_SECRET'),
    });
  } catch {
    return null;
  }
}

import type { DefaultEventsMap, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/types/authenticated-user.type';

export type AuthenticatedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { user?: JwtPayload }
>;

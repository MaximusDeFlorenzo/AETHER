import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user.type';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

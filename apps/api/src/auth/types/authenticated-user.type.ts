import { RoleName } from '../../common/enums/roles.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: RoleName;
}

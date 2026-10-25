import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import ms from 'ms';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken, User } from '../database/entities';
import type {
  AuthenticatedUser,
  JwtPayload,
} from './types/authenticated-user.type';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ tokens: TokenPair; user: User }> {
    // Case-insensitive: "Admin@…" typed on a phone is the same account.
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const tokens = await this.issueTokenPair(user);
    return { tokens, user };
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ tokens: TokenPair; user: User }> {
    const { id, secret } = this.parseRefreshToken(refreshToken);

    const existing = await this.refreshTokenRepository.findOne({
      where: { id },
      relations: { user: { role: true } },
    });

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() < Date.now() ||
      !(await bcrypt.compare(secret, existing.tokenHash))
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    existing.revokedAt = new Date();
    await this.refreshTokenRepository.save(existing);

    const tokens = await this.issueTokenPair(existing.user);
    return { tokens, user: existing.user };
  }

  async logout(refreshToken: string): Promise<void> {
    const { id } = this.parseRefreshToken(refreshToken);
    await this.refreshTokenRepository.update({ id }, { revokedAt: new Date() });
  }

  toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role.name,
    };
  }

  private async issueTokenPair(user: User): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.name,
    };
    const accessToken = this.jwtService.sign(
      payload as unknown as Record<string, unknown>,
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
      } as JwtSignOptions,
    );

    const refreshToken = await this.createRefreshToken(user);
    return { accessToken, refreshToken };
  }

  private async createRefreshToken(user: User): Promise<string> {
    const secret = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(secret, 10);
    const expiresInMs = ms(
      (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as Parameters<
        typeof ms
      >[0],
    );
    const expiresAt = new Date(Date.now() + expiresInMs);

    const row = this.refreshTokenRepository.create({
      user,
      tokenHash,
      expiresAt,
    });
    await this.refreshTokenRepository.save(row);

    return `${row.id}.${secret}`;
  }

  private parseRefreshToken(refreshToken: string): {
    id: string;
    secret: string;
  } {
    const [id, secret] = refreshToken.split('.');
    if (!id || !secret) {
      throw new UnauthorizedException('Malformed refresh token');
    }
    return { id, secret };
  }

  async pruneExpiredRefreshTokens(): Promise<void> {
    await this.refreshTokenRepository.delete({
      expiresAt: LessThan(new Date()),
    });
  }
}

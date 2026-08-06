import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role, User } from '../database/entities';
import { RoleName } from '../common/enums/roles.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
  ) {}

  async findAll(filters: {
    role?: RoleName;
    isActive?: boolean;
    page: number;
    limit: number;
  }) {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', 'DESC');

    if (filters.role) {
      qb.andWhere('role.name = :role', { role: filters.role });
    }
    if (filters.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: filters.isActive });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return {
      data: data.map((u) => this.toSafeUser(u)),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const role = await this.roleRepository.findOne({
      where: { name: dto.role },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role: ${dto.role}`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      role,
    });
    await this.userRepository.save(user);
    return this.toSafeUser(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const user = await this.findByIdOrThrow(id);

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.role !== undefined) {
      const role = await this.roleRepository.findOne({
        where: { name: dto.role },
      });
      if (!role) {
        throw new BadRequestException(`Unknown role: ${dto.role}`);
      }
      user.role = role;
    }

    await this.userRepository.save(user);
    return this.toSafeUser(user);
  }

  async deactivate(id: string): Promise<void> {
    const user = await this.findByIdOrThrow(id);
    user.isActive = false;
    await this.userRepository.save(user);
  }

  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.findByIdOrThrow(userId);
    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);
  }

  private async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // Flat `role` string here matches AuthService.toAuthenticatedUser()'s shape
  // — every endpoint that returns a user (login, me, users list/create/update)
  // agrees on one representation instead of leaking the full Role entity.
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

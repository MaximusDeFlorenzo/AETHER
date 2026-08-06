import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../database/entities';

// Thin lookup service — the four roles are fixed, seeded reference data
// (docs/DATABASE_SCHEMA.md §1) with no write endpoint; this exists so
// auth/users don't each duplicate a Role repository query.
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
  ) {}

  findAll(): Promise<Role[]> {
    return this.roleRepository.find({ order: { name: 'ASC' } });
  }
}

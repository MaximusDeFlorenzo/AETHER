import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(RoleName.ADMIN)
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll({
      role: query.role,
      isActive:
        query.isActive !== undefined ? query.isActive === 'true' : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post()
  @Roles(RoleName.ADMIN)
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.usersService.create(dto);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
    });
    return user;
  }

  @Patch('me/password')
  async changeOwnPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.usersService.changeOwnPassword(
      actor.id,
      dto.currentPassword,
      dto.newPassword,
    );
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'user.change_password',
      targetType: 'user',
      targetId: actor.id,
    });
    return { message: 'Password updated' };
  }

  @Patch(':id')
  @Roles(RoleName.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.usersService.update(id, dto);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      metadata: { ...dto },
    });
    return user;
  }

  @Delete(':id')
  @Roles(RoleName.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.usersService.deactivate(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'user.deactivate',
      targetType: 'user',
      targetId: id,
    });
  }
}

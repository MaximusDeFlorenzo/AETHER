import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { GroundReportsService } from './ground-reports.service';
import { CreateGroundReportDto } from './dto/create-ground-report.dto';
import { QueryGroundReportsDto } from './dto/query-ground-reports.dto';
import { TransitionGroundReportDto } from './dto/transition-ground-report.dto';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 5;
const IMAGE_UPLOAD = FilesInterceptor('images', MAX_FILES_PER_UPLOAD, {
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_UPLOAD },
});

const ALL_ROLES = [
  RoleName.FIELD_REPORTER,
  RoleName.ANALYST,
  RoleName.AGENCY_OPERATOR,
  RoleName.ADMIN,
];

// AETHER Ground Intelligence M1 — community observations and their review.
// Who may make which status change is decided per transition in
// lib/transitions.ts, not by the route-level @Roles alone. Field reporters
// only ever see their own reports, without reviewer identities or notes.
@ApiTags('ground-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ground-reports')
export class GroundReportsController {
  constructor(private readonly groundReportsService: GroundReportsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @Roles(...ALL_ROLES)
  @UseInterceptors(IMAGE_UPLOAD)
  create(
    @UploadedFiles() images: Express.Multer.File[],
    @Body() dto: CreateGroundReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.groundReportsService.submit(dto, images, actor);
  }

  @Get()
  @Roles(...ALL_ROLES)
  findAll(
    @Query() query: QueryGroundReportsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.groundReportsService.findAll(
      {
        status: query.status,
        observationType: query.observationType,
        page: query.page,
        limit: query.limit,
      },
      actor,
    );
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.groundReportsService.findOne(id, actor);
  }

  @Post(':id/evidence')
  @ApiConsumes('multipart/form-data')
  @Roles(...ALL_ROLES)
  @UseInterceptors(IMAGE_UPLOAD)
  addEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() images: Express.Multer.File[],
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.groundReportsService.addEvidence(id, images, actor);
  }

  @Post(':id/transitions')
  @Roles(RoleName.ANALYST, RoleName.AGENCY_OPERATOR, RoleName.ADMIN)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionGroundReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.groundReportsService.transition(id, dto, actor);
  }
}

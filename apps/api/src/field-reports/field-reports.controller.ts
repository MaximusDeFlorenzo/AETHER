import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FieldReportsService } from './field-reports.service';
import { CreateFieldReportDto } from './dto/create-field-report.dto';
import { QueryFieldReportsDto } from './dto/query-field-reports.dto';
import { LinkFieldReportDto } from './dto/link-field-report.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Citizen/field-reporter photo submission -> Computer Vision Engine review
// queue (docs/ARCHITECTURE.md §5) — the application-layer counterpart to
// the `cv_detections` schema that shipped in Phase 1 with no producer yet.
@ApiTags('field-reports')
@Controller('field-reports')
export class FieldReportsController {
  constructor(
    private readonly fieldReportsService: FieldReportsService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.FIELD_REPORTER, RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async create(
    @UploadedFile() image: Express.Multer.File,
    @Body() dto: CreateFieldReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!image) {
      throw new BadRequestException('An `image` file is required');
    }
    if (!ALLOWED_MIME_TYPES.has(image.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type '${image.mimetype}' — expected JPEG, PNG, or WebP`,
      );
    }

    const detections = await this.fieldReportsService.submit({
      image,
      hazardTypeHint: dto.hazardTypeHint,
      latitude: dto.latitude,
      longitude: dto.longitude,
      notes: dto.notes,
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'field_reports.submit',
      targetType: 'cv_detection_batch',
      metadata: {
        detectionCount: detections.length,
        hazardTypeHint: dto.hazardTypeHint ?? null,
      },
    });

    return { detections };
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR, RoleName.ANALYST)
  findAll(@Query() query: QueryFieldReportsDto) {
    return this.fieldReportsService.findAll({
      detectionType: query.detectionType,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR, RoleName.ANALYST)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fieldReportsService.findOne(id);
  }

  @Patch(':id/link')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR, RoleName.ANALYST)
  async link(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkFieldReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const updated = await this.fieldReportsService.linkToHazardEvent(
      id,
      dto.hazardEventId,
    );
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'field_reports.link',
      targetType: 'cv_detection',
      targetId: id,
      metadata: { hazardEventId: dto.hazardEventId },
    });
    return updated;
  }
}

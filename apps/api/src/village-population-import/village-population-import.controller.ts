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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { VillagePopulationImportService } from './village-population-import.service';
import { CreateImportBatchDto } from './dto/create-import-batch.dto';
import { QueryImportRowsDto } from './dto/query-import-rows.dto';
import { ResolveImportRowDto } from './dto/resolve-import-row.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'text/plain',
]);
// Reference-data write endpoints elsewhere in this codebase (e.g.
// VulnerabilityIndicatorsService.upsert) are ADMIN/ANALYST-gated; this
// follows the same posture — bulk population data is analyst-managed
// reference data, not a field-reporter/agency-operator concern.
const IMPORT_ROLES = [RoleName.ADMIN, RoleName.ANALYST] as const;

@ApiTags('village-population-import')
@Controller('village-population-imports')
export class VillagePopulationImportController {
  constructor(
    private readonly importService: VillagePopulationImportService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: VillagePopulationImportService.MAX_FILE_SIZE_BYTES },
    }),
  )
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateImportBatchDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A `file` (CSV) is required');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type '${file.mimetype}' — expected a CSV file`,
      );
    }

    const batch = await this.importService.createBatch({
      file: {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      hasHeaderRow: dto.hasHeaderRow,
      numberFormat: dto.numberFormat,
      sourceName: dto.sourceName,
      sourceReference: dto.sourceReference ?? null,
      periodStatus: dto.periodStatus,
      periodYear: dto.periodYear ?? null,
      uploadedByUserId: actor.id,
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'village_population_import.preview',
      targetType: 'village_population_import_batch',
      targetId: batch.id,
      metadata: { fileName: file.originalname, status: batch.status },
    });

    return batch;
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  getBatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.importService.getBatch(id);
  }

  @Get(':id/rows')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  getRows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryImportRowsDto,
  ) {
    return this.importService.getRows(id, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch(':batchId/rows/:rowId/resolve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  async resolveRow(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: ResolveImportRowDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const row = await this.importService.resolveRow(
      batchId,
      rowId,
      { action: dto.action, villageId: dto.villageId, note: dto.note },
      actor.id,
    );
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'village_population_import.resolve_row',
      targetType: 'village_population_import_row',
      targetId: row.id,
      metadata: {
        batchId,
        resolutionAction: dto.action,
        villageId: dto.villageId ?? null,
      },
    });
    return row;
  }

  @Post(':id/confirm')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const batch = await this.importService.confirmBatch(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'village_population_import.confirm',
      targetType: 'village_population_import_batch',
      targetId: batch.id,
      metadata: {
        importedCount: batch.importedCount,
        skippedCount: batch.skippedCount,
      },
    });
    return batch;
  }

  @Post(':id/retry')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const batch = await this.importService.retryBatch(id);
    await this.auditService.log({
      actorUserId: actor.id,
      action: 'village_population_import.retry',
      targetType: 'village_population_import_batch',
      targetId: batch.id,
      metadata: { status: batch.status },
    });
    return batch;
  }

  // Not publicly listable/servable — role-gated identically to the rest of
  // this controller, generated on demand from stored rows rather than a
  // persisted public file.
  @Get(':id/error-report.csv')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...IMPORT_ROLES)
  async downloadErrorReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    await this.importService.getBatch(id); // 404s before any header is sent
    // Not `@Res({ passthrough: true })` + `return csv` — verified live that
    // Nest's default response pipeline JSON-serializes a returned Buffer
    // (`{"type":"Buffer","data":[...]}`) regardless of the Content-Type
    // header, rather than sending it as the raw file bytes a CSV download
    // needs. Raw `res.write`/`res.end()` bypass that pipeline entirely and,
    // combined with `streamErrorReportRows`, mean the full report is never
    // materialized in memory at once even for a batch with tens of
    // thousands of error rows.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-${id}-error-report.csv"`,
    );
    for await (const chunk of this.importService.streamErrorReportRows(id)) {
      res.write(chunk);
    }
    res.end();
  }
}

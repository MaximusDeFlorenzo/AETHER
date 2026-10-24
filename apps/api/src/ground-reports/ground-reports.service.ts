import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  GroundReport,
  GroundReportEvidence,
  GroundReportStatusChange,
} from '../database/entities';
import { CvDetectionType } from '../common/enums/domain.enum';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { CvEngineClient } from '../risk-engine-orchestration/cv-engine.client';
import {
  GroundObservationType,
  GroundReportStatus,
  HAZARD_TYPE_BY_OBSERVATION,
} from './ground-report.enums';
import type { CreateGroundReportDto } from './dto/create-ground-report.dto';
import type { TransitionGroundReportDto } from './dto/transition-ground-report.dto';
import {
  checkTransition,
  EVIDENCE_OPEN_STATES,
  isReviewer,
} from './lib/transitions';
import {
  DUPLICATE_WINDOW_MS,
  findDuplicateOf,
  isWithinIndonesia,
  observedAtProblem,
} from './lib/report-rules';
import {
  InvalidImageError,
  readExifSummary,
  sniffImageType,
  stripImageMetadata,
} from './lib/image-evidence';

export const DEFAULT_GROUND_REPORTS_MAX_PER_HOUR = 10;
export const MAX_EVIDENCE_PER_REPORT = 10;
const STORAGE_PREFIX = 'ground-reports';

const CV_CATEGORIES: Record<GroundObservationType, CvDetectionType[]> = {
  [GroundObservationType.FLOODWATER]: [CvDetectionType.FLOOD],
  [GroundObservationType.FIRE]: [CvDetectionType.FIRE],
  [GroundObservationType.SMOKE]: [CvDetectionType.SMOKE],
};

const OBSERVED_AT_MESSAGES = {
  invalid: 'observedAt is not a valid timestamp',
  in_future: 'observedAt is in the future',
  too_old: 'observedAt is more than 30 days ago — not a live report',
} as const;

const TRANSITION_ERRORS = {
  invalid_transition: (from: string, to: string) =>
    new ConflictException(`Cannot move a report from '${from}' to '${to}'`),
  forbidden: () =>
    new ForbiddenException('Your role cannot make this status change'),
  reason_required: () =>
    new BadRequestException('A reason is required for this status change'),
};

interface PreparedEvidence {
  stripped: Buffer;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  exif: Record<string, unknown> | null;
}

/**
 * Community ground reports (AETHER Ground Intelligence M1): submission with
 * evidence photos, and an auditable review state machine. Nothing here
 * creates hazard events, emits domain events, sends notifications or
 * touches any model input — review outcome is recorded, nothing more.
 */
@Injectable()
export class GroundReportsService {
  private readonly logger = new Logger(GroundReportsService.name);

  constructor(
    @InjectRepository(GroundReport)
    private readonly reportRepository: Repository<GroundReport>,
    @InjectRepository(GroundReportEvidence)
    private readonly evidenceRepository: Repository<GroundReportEvidence>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly cvEngineClient: CvEngineClient,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  async submit(
    dto: CreateGroundReportDto,
    files: Express.Multer.File[],
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    if (!files?.length) {
      throw new BadRequestException('At least one image is required');
    }
    if (!isWithinIndonesia(dto.latitude, dto.longitude)) {
      throw new BadRequestException('Coordinates are outside Indonesia');
    }
    const observedAt = new Date(dto.observedAt);
    const problem = observedAtProblem(observedAt, now);
    if (problem) throw new BadRequestException(OBSERVED_AT_MESSAGES[problem]);
    if (
      dto.waterDepthCm != null &&
      dto.observationType !== GroundObservationType.FLOODWATER
    ) {
      throw new BadRequestException(
        'waterDepthCm is only accepted for floodwater observations',
      );
    }
    if (files.length > MAX_EVIDENCE_PER_REPORT) {
      throw new BadRequestException(
        `At most ${MAX_EVIDENCE_PER_REPORT} images per report`,
      );
    }

    await this.enforceRateLimit(actor.id, now);
    const prepared = files.map((file) => this.prepareEvidence(file));
    const duplicateOfId = await this.findDuplicateReport(actor.id, dto, now);
    const nearestDistrictId = await this.nearestDistrictId(
      dto.latitude,
      dto.longitude,
    );
    const storageKeys = await this.uploadAll(prepared);
    const cvHints = await this.cvHints(prepared, dto.observationType);

    let reportId: string;
    try {
      reportId = await this.dataSource.transaction(async (manager) => {
        const report = await manager.save(
          manager.create(GroundReport, {
            observationType: dto.observationType,
            status: GroundReportStatus.SUBMITTED,
            latitude: dto.latitude,
            longitude: dto.longitude,
            geom: {
              type: 'Point',
              coordinates: [dto.longitude, dto.latitude],
            } as unknown as object,
            nearestDistrictId,
            observedAt,
            description: dto.description.trim(),
            waterDepthCm: dto.waterDepthCm ?? null,
            reporterSeverity: dto.reporterSeverity ?? null,
            reporterId: actor.id,
            duplicateOfId,
          }),
        );
        await this.saveEvidence(
          manager,
          report.id,
          prepared,
          storageKeys,
          cvHints,
          actor.id,
        );
        await manager.save(
          manager.create(GroundReportStatusChange, {
            reportId: report.id,
            fromStatus: null,
            toStatus: GroundReportStatus.SUBMITTED,
            actorUserId: actor.id,
            reason: null,
            notes: null,
          }),
        );
        return report.id;
      });
    } catch (error) {
      await this.deleteObjects(storageKeys);
      throw error;
    }

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'ground_reports.submit',
      targetType: 'ground_report',
      targetId: reportId,
      metadata: {
        observationType: dto.observationType,
        evidenceCount: prepared.length,
        duplicateOfId,
      },
    });

    return this.findOne(reportId, actor);
  }

  /** Reporter-only: attach more photos while the report is still open for
   * evidence. Answering a NEEDS_MORE_EVIDENCE request sends the report back
   * to UNDER_REVIEW. */
  async addEvidence(
    id: string,
    files: Express.Multer.File[],
    actor: AuthenticatedUser,
  ) {
    if (!files?.length) {
      throw new BadRequestException('At least one image is required');
    }
    const report = await this.reportRepository.findOne({ where: { id } });
    if (!report || report.reporterId !== actor.id) {
      throw new NotFoundException('Ground report not found');
    }
    if (!EVIDENCE_OPEN_STATES.includes(report.status)) {
      throw new ConflictException(
        `Evidence cannot be added while the report is '${report.status}'`,
      );
    }
    const existing = await this.evidenceRepository.count({
      where: { reportId: id },
    });
    if (existing + files.length > MAX_EVIDENCE_PER_REPORT) {
      throw new BadRequestException(
        `At most ${MAX_EVIDENCE_PER_REPORT} images per report`,
      );
    }

    const prepared = files.map((file) => this.prepareEvidence(file));
    const storageKeys = await this.uploadAll(prepared);
    const cvHints = await this.cvHints(prepared, report.observationType);

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.saveEvidence(
          manager,
          id,
          prepared,
          storageKeys,
          cvHints,
          actor.id,
        );
        if (report.status === GroundReportStatus.NEEDS_MORE_EVIDENCE) {
          await this.applyTransition(manager, {
            id,
            from: report.status,
            to: GroundReportStatus.UNDER_REVIEW,
            actorId: actor.id,
            reason: 'Reporter added evidence',
            notes: null,
            byReviewer: false,
          });
        }
      });
    } catch (error) {
      await this.deleteObjects(storageKeys);
      throw error;
    }

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'ground_reports.evidence.add',
      targetType: 'ground_report',
      targetId: id,
      metadata: { evidenceCount: prepared.length },
    });

    return this.findOne(id, actor);
  }

  async transition(
    id: string,
    dto: TransitionGroundReportDto,
    actor: AuthenticatedUser,
  ) {
    const report = await this.reportRepository.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Ground report not found');

    const check = checkTransition({
      from: report.status,
      to: dto.to,
      role: actor.role,
      reason: dto.reason,
    });
    if (!check.ok) {
      throw TRANSITION_ERRORS[check.code](report.status, dto.to);
    }

    await this.dataSource.transaction((manager) =>
      this.applyTransition(manager, {
        id,
        from: report.status,
        to: dto.to,
        actorId: actor.id,
        reason: dto.reason?.trim() || null,
        notes: dto.notes?.trim() || null,
        byReviewer: true,
      }),
    );

    await this.auditService.log({
      actorUserId: actor.id,
      action: check.reopen
        ? 'ground_reports.reopen'
        : 'ground_reports.transition',
      targetType: 'ground_report',
      targetId: id,
      metadata: { from: report.status, to: dto.to },
    });

    return this.findOne(id, actor);
  }

  async findAll(
    filters: {
      status?: GroundReportStatus;
      observationType?: GroundObservationType;
      page: number;
      limit: number;
    },
    actor: AuthenticatedUser,
  ) {
    const reviewer = isReviewer(actor.role);
    const qb = this.reportRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.nearestDistrict', 'district')
      .loadRelationCountAndMap('r.evidenceCount', 'r.evidence')
      .orderBy('r.submittedAt', 'DESC');
    if (reviewer) {
      qb.leftJoinAndSelect('r.reporter', 'reporter');
    } else {
      qb.andWhere('r.reporterId = :reporterId', { reporterId: actor.id });
    }
    if (filters.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters.observationType) {
      qb.andWhere('r.observationType = :observationType', {
        observationType: filters.observationType,
      });
    }

    const [rows, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    return {
      data: rows.map((row) =>
        this.summaryView(
          row as GroundReport & { evidenceCount: number },
          reviewer,
        ),
      ),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const reviewer = isReviewer(actor.role);
    const report = await this.reportRepository.findOne({
      where: { id },
      relations: {
        nearestDistrict: true,
        reporter: true,
        evidence: true,
        statusHistory: true,
      },
    });
    if (!report || (!reviewer && report.reporterId !== actor.id)) {
      throw new NotFoundException('Ground report not found');
    }

    const evidence = await Promise.all(
      [...report.evidence]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(async (e) => ({
          id: e.id,
          mimeType: e.mimeType,
          sizeBytes: e.sizeBytes,
          createdAt: e.createdAt,
          imageUrl: await this.storageService.getSignedUrl(e.storageKey),
          ...(reviewer && {
            sha256: e.sha256,
            exif: e.exif,
            cvHint: e.cvHint,
            duplicateOfEvidenceId: e.duplicateOfEvidenceId,
            uploadedById: e.uploadedById,
          }),
        })),
    );
    const statusHistory = [...report.statusHistory]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        createdAt: h.createdAt,
        ...(reviewer && {
          id: h.id,
          actorUserId: h.actorUserId,
          notes: h.notes,
        }),
      }));

    return {
      ...this.summaryView(
        Object.assign(report, { evidenceCount: evidence.length }),
        reviewer,
      ),
      description: report.description,
      evidence,
      statusHistory,
    };
  }

  // -- internals -----------------------------------------------------------

  /** Field names a reporter may see are listed explicitly so a new column
   * never leaks by default; reviewer-only fields are added on top. */
  private summaryView(
    report: GroundReport & { evidenceCount: number },
    reviewer: boolean,
  ) {
    const base = {
      id: report.id,
      observationType: report.observationType,
      hazardType: HAZARD_TYPE_BY_OBSERVATION[report.observationType],
      status: report.status,
      latitude: report.latitude,
      longitude: report.longitude,
      nearestDistrict: report.nearestDistrict
        ? { id: report.nearestDistrict.id, name: report.nearestDistrict.name }
        : null,
      observedAt: report.observedAt,
      submittedAt: report.submittedAt,
      waterDepthCm: report.waterDepthCm,
      reporterSeverity: report.reporterSeverity,
      evidenceCount: report.evidenceCount,
      updatedAt: report.updatedAt,
    };
    if (!reviewer) return base;
    return {
      ...base,
      reporter: report.reporter
        ? { id: report.reporter.id, fullName: report.reporter.fullName }
        : { id: report.reporterId, fullName: null },
      duplicateOfId: report.duplicateOfId,
      trainingEligible: report.trainingEligible,
      lastReviewedById: report.lastReviewedById,
      lastReviewedAt: report.lastReviewedAt,
    };
  }

  /** Compare-and-swap on the current status: if another reviewer moved the
   * report first, zero rows match and this change is refused (409). */
  private async applyTransition(
    manager: EntityManager,
    input: {
      id: string;
      from: GroundReportStatus;
      to: GroundReportStatus;
      actorId: string;
      reason: string | null;
      notes: string | null;
      byReviewer: boolean;
    },
  ): Promise<void> {
    const set: Partial<GroundReport> = { status: input.to };
    if (input.byReviewer) {
      set.lastReviewedById = input.actorId;
      set.lastReviewedAt = new Date();
    }
    const result = await manager
      .createQueryBuilder()
      .update(GroundReport)
      .set(set)
      .where('id = :id AND status = :from', { id: input.id, from: input.from })
      .execute();
    if (!result.affected) {
      throw new ConflictException(
        'The report changed status while you were reviewing it — reload and try again',
      );
    }
    await manager.save(
      manager.create(GroundReportStatusChange, {
        reportId: input.id,
        fromStatus: input.from,
        toStatus: input.to,
        actorUserId: input.actorId,
        reason: input.reason,
        notes: input.notes,
      }),
    );
  }

  private async enforceRateLimit(reporterId: string, now: Date) {
    const limit =
      this.config.get<number>('GROUND_REPORTS_MAX_PER_HOUR') ??
      DEFAULT_GROUND_REPORTS_MAX_PER_HOUR;
    const recent = await this.reportRepository.count({
      where: {
        reporterId,
        submittedAt: MoreThanOrEqual(new Date(now.getTime() - 3_600_000)),
      },
    });
    if (recent >= limit) {
      throw new HttpException(
        `Report limit reached (${limit} per hour) — try again later`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findDuplicateReport(
    reporterId: string,
    dto: CreateGroundReportDto,
    now: Date,
  ): Promise<string | null> {
    const recent = await this.reportRepository.find({
      where: {
        reporterId,
        submittedAt: MoreThanOrEqual(
          new Date(now.getTime() - DUPLICATE_WINDOW_MS),
        ),
      },
      select: {
        id: true,
        observationType: true,
        latitude: true,
        longitude: true,
        submittedAt: true,
      },
    });
    return findDuplicateOf(
      {
        observationType: dto.observationType,
        latitude: dto.latitude,
        longitude: dto.longitude,
        submittedAt: now,
      },
      recent,
    );
  }

  private async nearestDistrictId(
    latitude: number,
    longitude: number,
  ): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.reportRepository.query(
      `SELECT id FROM districts
       ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT 1`,
      [longitude, latitude],
    );
    return rows[0]?.id ?? null;
  }

  private prepareEvidence(file: Express.Multer.File): PreparedEvidence {
    const type = sniffImageType(file.buffer);
    if (!type) {
      throw new BadRequestException(
        `'${file.originalname}' is not a JPEG, PNG or WebP image`,
      );
    }
    try {
      const { buffer, exifTiff } = stripImageMetadata(file.buffer, type);
      const exif = readExifSummary(exifTiff);
      const hasExif =
        exif.dateTimeOriginal !== null ||
        exif.offsetTimeOriginal !== null ||
        exif.gps !== null;
      return {
        stripped: buffer,
        mimeType: type,
        sizeBytes: buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        exif: hasExif ? { ...exif } : null,
      };
    } catch (error) {
      if (error instanceof InvalidImageError) {
        throw new BadRequestException(
          `'${file.originalname}' is not a readable image: ${error.message}`,
        );
      }
      throw error;
    }
  }

  private async uploadAll(prepared: PreparedEvidence[]): Promise<string[]> {
    const keys: string[] = [];
    try {
      for (const item of prepared) {
        keys.push(
          await this.storageService.uploadObject(
            STORAGE_PREFIX,
            item.stripped,
            item.mimeType,
          ),
        );
      }
      return keys;
    } catch (error) {
      await this.deleteObjects(keys);
      throw error;
    }
  }

  private async deleteObjects(keys: string[]) {
    await Promise.all(
      keys.map((key) =>
        this.storageService
          .deleteObject(key)
          .catch((error: unknown) =>
            this.logger.warn(
              `Orphaned evidence object ${key}: ${String(error)}`,
            ),
          ),
      ),
    );
  }

  /** Best effort: a CV engine outage must never block a report. */
  private async cvHints(
    prepared: PreparedEvidence[],
    observationType: GroundObservationType,
  ): Promise<Array<Record<string, unknown> | null>> {
    return Promise.all(
      prepared.map(async (item) => {
        try {
          const result = await this.cvEngineClient.detectCv({
            imageBase64: item.stripped.toString('base64'),
            categories: CV_CATEGORIES[observationType],
          });
          return {
            modelVersion: result.modelVersion,
            detections: result.detections.map((d) => ({
              detectionType: d.detectionType,
              confidenceScore: d.confidenceScore,
            })),
          };
        } catch (error) {
          this.logger.warn(`CV hint unavailable: ${String(error)}`);
          return null;
        }
      }),
    );
  }

  private async saveEvidence(
    manager: EntityManager,
    reportId: string,
    prepared: PreparedEvidence[],
    storageKeys: string[],
    cvHints: Array<Record<string, unknown> | null>,
    uploadedById: string,
  ) {
    for (const [i, item] of prepared.entries()) {
      const earlier = await manager.findOne(GroundReportEvidence, {
        where: { sha256: item.sha256 },
        order: { createdAt: 'ASC' },
        select: { id: true },
      });
      await manager.save(
        manager.create(GroundReportEvidence, {
          reportId,
          storageKey: storageKeys[i],
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
          exif: item.exif,
          cvHint: cvHints[i],
          duplicateOfEvidenceId: earlier?.id ?? null,
          uploadedById,
        }),
      );
    }
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CvDetection, HazardEvent } from '../database/entities';
import { CvDetectionType, HazardType } from '../common/enums/domain.enum';
import { StorageService } from '../storage/storage.service';
import { CvEngineClient } from '../risk-engine-orchestration/cv-engine.client';

// A hazardTypeHint narrows which detectors the CV engine runs — e.g. a
// citizen tagging their photo "wildfire" only needs fire/smoke checked, not
// flood/infra_damage too. Omitted or unmapped hint types run every detector
// (CvEngineClient.detectCv with `categories: undefined`).
const CATEGORIES_BY_HAZARD_HINT: Partial<
  Record<HazardType, CvDetectionType[]>
> = {
  [HazardType.FLOOD]: [CvDetectionType.FLOOD],
  [HazardType.WILDFIRE]: [CvDetectionType.FIRE, CvDetectionType.SMOKE],
  [HazardType.EARTHQUAKE]: [CvDetectionType.INFRA_DAMAGE],
  [HazardType.LANDSLIDE]: [CvDetectionType.INFRA_DAMAGE],
};

export interface SubmitFieldReportInput {
  image: Express.Multer.File;
  hazardTypeHint?: HazardType;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

@Injectable()
export class FieldReportsService {
  private readonly logger = new Logger(FieldReportsService.name);

  constructor(
    @InjectRepository(CvDetection)
    private readonly cvDetectionRepository: Repository<CvDetection>,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    private readonly storageService: StorageService,
    private readonly cvEngineClient: CvEngineClient,
  ) {}

  /**
   * Uploads the photo to storage, runs it through the CV engine, and
   * persists one `cv_detections` row per detection found (`hazardEvent`
   * left null — see `linkToHazardEvent` for the human-review promotion
   * step). Returns an empty array, not an error, when nothing is detected:
   * "we processed your photo; here's what we found" — silence is a valid
   * (if unhelpful) outcome, not a failure.
   */
  async submit(input: SubmitFieldReportInput): Promise<CvDetection[]> {
    const sourceImageRef = await this.storageService.uploadObject(
      'field-reports',
      input.image.buffer,
      input.image.mimetype,
    );

    const categories = input.hazardTypeHint
      ? CATEGORIES_BY_HAZARD_HINT[input.hazardTypeHint]
      : undefined;

    const result = await this.cvEngineClient.detectCv({
      imageBase64: input.image.buffer.toString('base64'),
      categories,
    });

    this.logger.log(
      `Field report processed: ${result.detections.length} detection(s) from ${sourceImageRef}`,
    );

    if (result.detections.length === 0) {
      return [];
    }

    return this.cvDetectionRepository.save(
      result.detections.map((detection) =>
        this.cvDetectionRepository.create({
          detectionType: detection.detectionType,
          hazardEvent: null,
          sourceImageRef,
          boundingBoxes: detection.boundingBoxes,
          confidenceScore: detection.confidenceScore,
        }),
      ),
    );
  }

  async findAll(filters: {
    detectionType?: CvDetectionType;
    page: number;
    limit: number;
  }) {
    const qb = this.cvDetectionRepository
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.hazardEvent', 'hazardEvent')
      .orderBy('d.createdAt', 'DESC');

    if (filters.detectionType) {
      qb.andWhere('d.detectionType = :detectionType', {
        detectionType: filters.detectionType,
      });
    }

    const [data, total] = await qb
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();

    const withSignedUrls = await this.attachSignedUrls(data);

    return {
      data: withSignedUrls,
      meta: { page: filters.page, limit: filters.limit, total },
    };
  }

  async findOne(id: string): Promise<CvDetection & { imageUrl: string }> {
    const detection = await this.cvDetectionRepository.findOne({
      where: { id },
      relations: { hazardEvent: true },
    });
    if (!detection) {
      throw new NotFoundException('Field report / CV detection not found');
    }
    const [withUrl] = await this.attachSignedUrls([detection]);
    return withUrl;
  }

  /** Human-review promotion step: links a detection to a concrete hazard
   * event once a reviewer confirms it corroborates one — the
   * `hazard_event_id`-nullable design `cv_detections` was built for
   * (docs/DATABASE_SCHEMA.md §22). */
  async linkToHazardEvent(
    detectionId: string,
    hazardEventId: string,
  ): Promise<CvDetection> {
    const detection = await this.cvDetectionRepository.findOne({
      where: { id: detectionId },
    });
    if (!detection) {
      throw new NotFoundException('Field report / CV detection not found');
    }
    const hazardEvent = await this.hazardEventRepository.findOne({
      where: { id: hazardEventId },
    });
    if (!hazardEvent) {
      throw new NotFoundException('Hazard event not found');
    }
    detection.hazardEvent = hazardEvent;
    return this.cvDetectionRepository.save(detection);
  }

  private async attachSignedUrls(
    detections: CvDetection[],
  ): Promise<Array<CvDetection & { imageUrl: string }>> {
    return Promise.all(
      detections.map(async (detection) =>
        Object.assign(detection, {
          imageUrl: await this.storageService.getSignedUrl(
            detection.sourceImageRef,
          ),
        }),
      ),
    );
  }
}

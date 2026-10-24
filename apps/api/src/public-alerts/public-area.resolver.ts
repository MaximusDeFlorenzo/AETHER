import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { District, Subdistrict, Village } from '../database/entities';

export interface ResolvedArea {
  district: District;
  subdistrict: Subdistrict | null;
  village: Village | null;
}

/**
 * Loads a district[/subdistrict[/village]] triple and checks each level
 * really belongs to its parent, so an alarm or a subscription can never be
 * filed under a village that sits in a different district than the one it
 * claims (which would silently route alarms to the wrong people).
 */
@Injectable()
export class PublicAreaResolver {
  constructor(
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(Subdistrict)
    private readonly subdistrictRepository: Repository<Subdistrict>,
    @InjectRepository(Village)
    private readonly villageRepository: Repository<Village>,
  ) {}

  async resolve(
    districtId: string,
    subdistrictId?: string,
    villageId?: string,
  ): Promise<ResolvedArea> {
    if (villageId && !subdistrictId) {
      throw new BadRequestException('villageId requires subdistrictId');
    }

    const district = await this.districtRepository.findOne({
      where: { id: districtId },
    });
    if (!district) {
      throw new BadRequestException(`District ${districtId} not found`);
    }

    let subdistrict: Subdistrict | null = null;
    if (subdistrictId) {
      subdistrict = await this.subdistrictRepository.findOne({
        where: { id: subdistrictId },
        relations: { district: true },
      });
      if (!subdistrict || subdistrict.district.id !== district.id) {
        throw new BadRequestException(
          `Subdistrict ${subdistrictId} is not in district ${districtId}`,
        );
      }
    }

    let village: Village | null = null;
    if (villageId && subdistrict) {
      village = await this.villageRepository.findOne({
        where: { id: villageId },
        relations: { subdistrict: true },
      });
      if (!village || village.subdistrict.id !== subdistrict.id) {
        throw new BadRequestException(
          `Village ${villageId} is not in subdistrict ${subdistrictId}`,
        );
      }
    }

    return { district, subdistrict, village };
  }
}

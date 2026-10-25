import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  PublicAlertHazard,
  PublicAlertLevel,
  PublicAlertResponseStatus,
} from '../public-alert.enums';

export class AreaQueryDto {
  @IsUUID()
  district: string;

  @IsOptional()
  @IsUUID()
  subdistrict?: string;

  @IsOptional()
  @IsUUID()
  village?: string;
}

export class CreatePublicAlertDto {
  @IsEnum(PublicAlertHazard)
  hazard: PublicAlertHazard;

  @IsOptional()
  @IsEnum(PublicAlertLevel)
  level?: PublicAlertLevel = PublicAlertLevel.AWAS;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  action: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destinationName?: string;

  // Both-or-neither: a lone latitude can't be turned into a route.
  @ValidateIf(
    (dto: CreatePublicAlertDto) => dto.destinationLongitude !== undefined,
  )
  @Type(() => Number)
  @IsLatitude()
  destinationLatitude?: number;

  @ValidateIf(
    (dto: CreatePublicAlertDto) => dto.destinationLatitude !== undefined,
  )
  @Type(() => Number)
  @IsLongitude()
  destinationLongitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  avoidText?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  sourceLabel: string;

  @IsUUID()
  districtId: string;

  @IsOptional()
  @IsUUID()
  subdistrictId?: string;

  @IsOptional()
  @IsUUID()
  villageId?: string;

  @IsOptional()
  @IsUUID()
  hazardEventId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(72)
  expiresInHours: number = 12;
}

export class QueryPublicAlertsDto extends PaginationDto {}

class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;
}

// Mirrors the browser's PushSubscription.toJSON() shape so the client can
// send it as-is, plus the area the citizen picked.
export class CreatePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  endpoint: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;

  @IsOptional()
  expirationTime?: number | null;

  @IsUUID()
  districtId: string;

  @IsOptional()
  @IsUUID()
  subdistrictId?: string;

  @IsOptional()
  @IsUUID()
  villageId?: string;
}

export class RemovePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  endpoint: string;
}

export class CreateAlertResponseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId: string;

  @IsEnum(PublicAlertResponseStatus)
  status: PublicAlertResponseStatus;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  peopleCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ()-]{6,30}$/, {
    message: 'contactPhone must be a phone number',
  })
  contactPhone?: string;
}

// `lat,lng;lat,lng;…` — one query string keeps the request cacheable and
// avoids a POST for what is a pure read.
export class WindQueryDto {
  @IsString()
  @MaxLength(1200)
  @Matches(
    /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?(;-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?)*$/,
    {
      message: 'points must be "lat,lng;lat,lng"',
    },
  )
  points: string;
}

export class LocateQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

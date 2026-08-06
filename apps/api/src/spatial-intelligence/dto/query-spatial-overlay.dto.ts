import { IsEnum, IsOptional, IsString } from 'class-validator';
import { HazardType } from '../../common/enums/domain.enum';

export enum OverlayLayer {
  RISK = 'risk',
  VULNERABILITY = 'vulnerability',
  EXPOSURE = 'exposure',
}

export class QuerySpatialOverlayDto {
  @IsEnum(OverlayLayer)
  layer: OverlayLayer;

  @IsOptional()
  @IsEnum(HazardType)
  hazardType?: HazardType;

  // "minLon,minLat,maxLon,maxLat" — kept as a raw comma-separated string
  // (rather than 4 separate query params) to match the common GeoJSON/OGC
  // bbox convention docs/API_SPEC.md §6 references.
  @IsOptional()
  @IsString()
  bbox?: string;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../transformers/numeric.transformer';
import { District } from './district.entity';
import { WeatherDataKind } from '../../rainfall-intelligence/rainfall.enums';

/**
 * One hour of weather at one kabupaten/kota reference point
 * (`districts.geom`, a single GeoNames point — NOT an area average), from
 * one source. The persisted history that rainfall aggregation, flood/
 * landslide features and later backtesting are computed from
 * (docs/RAINFALL_INTELLIGENCE.md).
 *
 * `valid_time` is the END of the hour: `precipitation_mm` is the total over
 * (valid_time - 1h, valid_time], Open-Meteo's convention. Wind directions
 * are meteorological "from" degrees [0, 360). Every measured column is
 * nullable: an invalid or unit-unknown value is stored as NULL with a
 * reason in `quality_flags`, never guessed.
 */
@Entity('weather_hourly_samples')
@Unique('uq_weather_hourly_samples_district_source_time', [
  'district',
  'source',
  'validTime',
])
export class WeatherHourlySample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => District, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'district_id' })
  district: District;

  @Column({ type: 'varchar', length: 40 })
  source: string;

  @Column({
    type: 'enum',
    enum: WeatherDataKind,
    enumName: 'weather_data_kind',
    name: 'data_kind',
  })
  dataKind: WeatherDataKind;

  @Index('idx_weather_hourly_samples_valid_time')
  @Column({ type: 'timestamptz', name: 'valid_time' })
  validTime: Date;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  latitude: number;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    transformer: numericTransformer,
  })
  longitude: number;

  // Elevation of the provider's grid cell, which can differ from the
  // district point's real elevation.
  @Column({ type: 'real', nullable: true, name: 'grid_elevation_m' })
  gridElevationM: number | null;

  @Column({ type: 'real', nullable: true, name: 'precipitation_mm' })
  precipitationMm: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_speed_10m_kmh' })
  windSpeed10mKmh: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_from_10m_deg' })
  windFrom10mDeg: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_speed_850hpa_kmh' })
  windSpeed850hPaKmh: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_from_850hpa_deg' })
  windFrom850hPaDeg: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_speed_700hpa_kmh' })
  windSpeed700hPaKmh: number | null;

  @Column({ type: 'real', nullable: true, name: 'wind_from_700hpa_deg' })
  windFrom700hPaDeg: number | null;

  @Column({ type: 'real', nullable: true, name: 'temperature_c' })
  temperatureC: number | null;

  @Column({ type: 'real', nullable: true, name: 'relative_humidity_pct' })
  relativeHumidityPct: number | null;

  @Column({ type: 'real', nullable: true, name: 'surface_pressure_hpa' })
  surfacePressureHpa: number | null;

  // Volumetric soil water, 9-27 cm layer (m³/m³) — model value.
  @Column({
    type: 'real',
    nullable: true,
    name: 'soil_moisture_9_27cm_m3m3',
  })
  soilMoisture9To27cmM3m3: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'", name: 'quality_flags' })
  qualityFlags: string[];

  // When this row's values were last fetched from the provider. A later
  // ingestion overwrites the row with the provider's newer values for the
  // same hour.
  @Column({ type: 'timestamptz', name: 'retrieved_at' })
  retrievedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}

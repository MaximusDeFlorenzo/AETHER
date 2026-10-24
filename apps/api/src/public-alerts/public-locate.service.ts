import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { District, Subdistrict, Village } from '../database/entities';

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const NEAREST_CANDIDATES = 8;
// Coordinates are rounded before leaving this server (~110 m) — enough to
// tell villages apart, without forwarding a citizen's exact position.
const COORD_PRECISION = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Nominatim's public usage policy: at most 1 request per second.
const NOMINATIM_MIN_INTERVAL_MS = 1100;

// Address keys whose values name a kecamatan-level place vs a desa-level
// one in OSM's Indonesian tagging. `town` is deliberately NOT a village key:
// it is usually the kecamatan's main town, which often shares its name with
// one desa — matching it as a desa would place everyone in town there.
const SUBDISTRICT_KEYS = [
  'city_district',
  'district',
  'municipality',
  'town',
  'suburb',
  'subdistrict',
];
const VILLAGE_KEYS = [
  'village',
  'hamlet',
  'suburb',
  'neighbourhood',
  'quarter',
  'residential',
];

export type LocatePrecision = 'desa' | 'kecamatan' | 'kabupaten';

export interface LocateResult {
  district: {
    id: string;
    name: string;
    provinceName: string | null;
    point: [number, number] | null;
  };
  subdistrict: { id: string; name: string } | null;
  village: { id: string; name: string } | null;
  precision: LocatePrecision;
  /** 'reverse-geocode' = matched OSM names; 'nearest' = nearest district reference point only. */
  method: 'reverse-geocode' | 'nearest';
}

type AddressMap = Record<string, string>;

/** Lower-case, strip administrative prefixes and punctuation, so
 * "Kota Administrasi Jakarta Selatan" and "Jakarta Selatan" compare equal. */
export function normalizeAreaName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(kabupaten|kab\.?|kota administrasi|kota adm\.?|kota|kecamatan|kec\.?|kelurahan|kel\.?|desa|administrasi)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Picks the district among the nearest candidates whose name appears in the
 * reverse-geocoded address. OSM tags a kabupaten as `county` and a kota as
 * `city`/`city_district`, which separates same-named pairs such as
 * Kabupaten Sukabumi / Kota Sukabumi. Candidates arrive nearest-first, so
 * ties go to the closer one; null when nothing matches by name.
 */
export function pickDistrict<T extends { name: string }>(
  candidates: T[],
  address: AddressMap,
): T | null {
  let best: { candidate: T; score: number } | null = null;
  for (const candidate of candidates) {
    const normalized = normalizeAreaName(candidate.name);
    let score = 0;
    for (const [key, value] of Object.entries(address)) {
      if (normalizeAreaName(value) !== normalized) continue;
      score = Math.max(score, 10);
      const isKota = /^kota\b/i.test(candidate.name);
      if (key === 'county' && !isKota) score = 12;
      if ((key === 'city' || key === 'city_district') && isKota) score = 12;
    }
    if (score > 0 && (!best || score > best.score)) best = { candidate, score };
  }
  return best?.candidate ?? null;
}

/** Unique match of `items` by name against the address values under `keys`. */
export function matchByName<T extends { name: string }>(
  items: T[],
  address: AddressMap,
  keys: string[],
): T | null {
  const wanted = new Set(
    keys
      .map((key) => address[key])
      .filter(Boolean)
      .map(normalizeAreaName),
  );
  if (wanted.size === 0) return null;
  const matches = items.filter((item) =>
    wanted.has(normalizeAreaName(item.name)),
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * GPS → district/subdistrict/village for the citizen portal's automatic
 * location. Villages and subdistricts have no geometry in this database
 * (names/codes only), so the finer levels come from matching OpenStreetMap
 * reverse-geocoding names (Nominatim) against the Kemendagri names here.
 * Falls back to the nearest district reference point when OSM is
 * unreachable or names don't match — the portal then shows only the
 * kabupaten/kota and says so.
 */
@Injectable()
export class PublicLocateService {
  private readonly logger = new Logger(PublicLocateService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: LocateResult }
  >();
  private nominatimQueue: Promise<unknown> = Promise.resolve();
  private lastNominatimAt = 0;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    @InjectRepository(Subdistrict)
    private readonly subdistrictRepository: Repository<Subdistrict>,
    @InjectRepository(Village)
    private readonly villageRepository: Repository<Village>,
  ) {}

  async locate(
    latitude: number,
    longitude: number,
  ): Promise<LocateResult | null> {
    const lat = Number(latitude.toFixed(COORD_PRECISION));
    const lng = Number(longitude.toFixed(COORD_PRECISION));
    const key = `${lat},${lng}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const candidates = await this.nearestDistricts(lat, lng);
    if (candidates.length === 0) return null;

    const address = await this.reverseGeocode(lat, lng);
    const matched = address ? pickDistrict(candidates, address) : null;
    const district = matched ?? candidates[0];

    let subdistrict: Subdistrict | null = null;
    let village: Village | null = null;
    if (matched && address) {
      const subdistricts = await this.subdistrictRepository.find({
        where: { district: { id: district.id } },
      });
      subdistrict = matchByName(subdistricts, address, SUBDISTRICT_KEYS);
      if (subdistrict) {
        const villages = await this.villageRepository.find({
          where: { subdistrict: { id: subdistrict.id } },
        });
        village = matchByName(villages, address, VILLAGE_KEYS);
      } else {
        // OSM often omits the kecamatan (e.g. Jakarta) but names the
        // kelurahan — find it district-wide and take its kecamatan.
        const villages = await this.villageRepository.find({
          where: { subdistrict: { district: { id: district.id } } },
          relations: { subdistrict: true },
        });
        village = matchByName(villages, address, VILLAGE_KEYS);
        subdistrict = village?.subdistrict ?? null;
      }
    }

    const point =
      (district.geom as { coordinates?: [number, number] } | null)
        ?.coordinates ?? null;
    const value: LocateResult = {
      district: {
        id: district.id,
        name: district.name,
        provinceName: district.province?.name ?? null,
        point,
      },
      subdistrict: subdistrict
        ? { id: subdistrict.id, name: subdistrict.name }
        : null,
      village: village ? { id: village.id, name: village.name } : null,
      precision: village ? 'desa' : subdistrict ? 'kecamatan' : 'kabupaten',
      method: matched ? 'reverse-geocode' : 'nearest',
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async nearestDistricts(
    lat: number,
    lng: number,
  ): Promise<District[]> {
    const rows: Array<{ id: string }> = await this.districtRepository.query(
      `SELECT id FROM districts
       WHERE geom IS NOT NULL
       ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT ${NEAREST_CANDIDATES}`,
      [lng, lat],
    );
    if (rows.length === 0) return [];
    const districts = await this.districtRepository.find({
      where: rows.map((row) => ({ id: row.id })),
      relations: { province: true },
    });
    const order = new Map(rows.map((row, index) => [row.id, index]));
    return districts.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
  }

  /** Serialized so this process never exceeds Nominatim's 1 req/s policy. */
  private reverseGeocode(lat: number, lng: number): Promise<AddressMap | null> {
    const run = async (): Promise<AddressMap | null> => {
      const wait =
        this.lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastNominatimAt = Date.now();
      const baseUrl =
        this.config.get<string>('NOMINATIM_BASE_URL') ?? DEFAULT_NOMINATIM_URL;
      const contact =
        this.config.get<string>('VAPID_SUBJECT')?.replace(/^mailto:/, '') ??
        'admin@aether.local';
      try {
        const { data } = await firstValueFrom(
          this.http.get<{ address?: AddressMap }>(`${baseUrl}/reverse`, {
            params: {
              format: 'jsonv2',
              lat,
              lon: lng,
              zoom: 18,
              addressdetails: 1,
              'accept-language': 'id',
            },
            headers: { 'User-Agent': `AETHER-Siaga/0.1 (${contact})` },
            timeout: 6_000,
          }),
        );
        return data.address ?? null;
      } catch (error) {
        this.logger.warn(
          `Reverse geocoding failed: ${(error as Error).message}`,
        );
        return null;
      }
    };
    const result = this.nominatimQueue.then(run, run);
    this.nominatimQueue = result.catch(() => undefined);
    return result;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HazardType } from '../common/enums/domain.enum';
import {
  DomainEvents,
  type HazardEventCreatedEvent,
} from '../common/events/domain-events';
import { HazardEvent } from '../database/entities';
import { GeoService } from '../geo/geo.service';
import { PublicAlertHazard } from './public-alert.enums';
import { PublicAlertsService } from './public-alerts.service';

const BMKG_SOURCE = 'bmkg_gempaterkini';

// gempaterkini only lists M ≥ 5.0, but the floor is explicit so a feed
// change can't start waking people for small quakes.
const MIN_MAGNITUDE = 5.0;

// Same magnitude → radius rule SpatialIntelligenceService uses for the
// affected-district list (M5 = 50 km, M6 = 100 km, M7 = 150 km).
const QUAKE_RADIUS_KM_PER_MAGNITUDE = 50;
const QUAKE_RADIUS_BASE_MAGNITUDE = 4.0;
const QUAKE_MAX_RADIUS_KM = 300;

// A tsunami can reach coasts well beyond the shaking radius. Districts
// have no coastline flag yet, so inland ones inside this radius are
// warned too — the message tells them it only applies near the sea.
const TSUNAMI_RADIUS_KM = 300;

// Only relay fresh events: on a fresh database (or after downtime) the
// first poll ingests the feed's backlog of earlier quakes, which must
// never sound as new alarms.
const MAX_EVENT_AGE_MS = 30 * 60 * 1000;

const QUAKE_ALERT_HOURS = 3;
const TSUNAMI_ALERT_HOURS = 6;

const SOURCE_LABEL = 'BMKG · diteruskan otomatis oleh AETHER';

function formatMagnitude(magnitude: number): string {
  return magnitude.toFixed(1).replace('.', ',');
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/**
 * Tier 1 of citizen alerting: relays BMKG's own earthquake information to
 * subscribers in nearby districts with no operator in the loop, because
 * the decision is BMKG's (the mandated agency) and minutes matter for a
 * tsunami. AETHER's own model outputs never trigger these alarms — those
 * stay with BPBD operators.
 */
@Injectable()
export class BmkgAutoAlertService {
  private readonly logger = new Logger(BmkgAutoAlertService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    private readonly geoService: GeoService,
    private readonly publicAlertsService: PublicAlertsService,
  ) {}

  @OnEvent(DomainEvents.HAZARD_EVENT_CREATED, { async: true })
  async handleHazardEventCreated(payload: HazardEventCreatedEvent) {
    if (payload.hazardType !== HazardType.EARTHQUAKE) return;
    if (this.config.get<string>('BMKG_AUTO_ALERTS_ENABLED') === 'false') return;
    try {
      await this.relay(payload.hazardEventId);
    } catch (error) {
      this.logger.error(
        `BMKG auto-alert for ${payload.hazardEventId} failed: ${(error as Error).message}`,
      );
    }
  }

  async relay(hazardEventId: string, now = new Date()): Promise<number> {
    const event = await this.hazardEventRepository.findOne({
      where: { id: hazardEventId },
      relations: { earthquakeDetails: true },
    });
    const details = event?.earthquakeDetails;
    if (!event || !details || event.source !== BMKG_SOURCE) return 0;
    if (now.getTime() - event.eventTime.getTime() > MAX_EVENT_AGE_MS) return 0;
    if (details.magnitude < MIN_MAGNITUDE) return 0;
    if (await this.publicAlertsService.existsForHazardEvent(event.id)) return 0;

    const tsunami = details.potentialTsunami;
    const radiusKm = tsunami
      ? TSUNAMI_RADIUS_KM
      : Math.min(
          QUAKE_MAX_RADIUS_KM,
          Math.round(
            QUAKE_RADIUS_KM_PER_MAGNITUDE *
              (details.magnitude - QUAKE_RADIUS_BASE_MAGNITUDE),
          ),
        );
    const districts = await this.geoService.findDistrictsReachingPoint(
      event.latitude,
      event.longitude,
      radiusKm * 1000,
    );

    const magnitude = formatMagnitude(details.magnitude);
    const where = event.locationLabel ?? 'di sekitar wilayah Anda';
    const when = formatTime(event.eventTime);
    for (const district of districts) {
      const distance = Math.round(district.distanceKm);
      const quake = `Gempa magnitudo ${magnitude} (kedalaman ${Math.round(details.depthKm)} km) pukul ${when} WIB, ${where}, sekitar ${distance} km dari pusat ${district.name}.`;
      await this.publicAlertsService.issueAutomatic(
        tsunami
          ? {
              hazard: PublicAlertHazard.TSUNAMI,
              title: `Gempa M${magnitude} berpotensi tsunami`,
              action: 'Jauhi pantai, segera ke tempat tinggi',
              message: `${quake} BMKG menyatakan gempa ini berpotensi tsunami. Jika Anda berada di dekat pantai atau muara sungai, segera menjauh ke tempat tinggi atau ke dalam daratan. Jangan menunggu air laut surut. Ikuti arahan BMKG dan BPBD setempat.`,
              avoidText: 'Pantai, muara sungai, dan dataran rendah dekat laut',
              sourceLabel: SOURCE_LABEL,
              districtId: district.id,
              hazardEventId: event.id,
              expiresInHours: TSUNAMI_ALERT_HOURS,
            }
          : {
              hazard: PublicAlertHazard.EARTHQUAKE,
              title: `Gempa M${magnitude}`,
              action: 'Waspada gempa susulan',
              message: `${quake} Periksa keadaan keluarga, keluar dari bangunan yang retak, dan waspadai gempa susulan. Jangan mudah percaya kabar yang bukan dari BMKG.`,
              avoidText: 'Bangunan retak, tebing, dan tiang listrik',
              sourceLabel: SOURCE_LABEL,
              districtId: district.id,
              hazardEventId: event.id,
              expiresInHours: QUAKE_ALERT_HOURS,
            },
      );
    }
    this.logger.log(
      `BMKG ${tsunami ? 'tsunami' : 'earthquake'} M${details.magnitude} (${event.id}): auto-alerted ${districts.length} district(s) within ${radiusKm} km`,
    );
    return districts.length;
  }
}

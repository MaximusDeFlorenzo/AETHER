'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight, CloudFog, Info, Map as MapIcon } from 'lucide-react';
import { useNationalEvents } from '@/hooks/use-national-events';
import { usePublicWeather } from '@/hooks/use-public-alerts';
import { bearingDeg, compassName, formatDistance, locationLatLng, smokeLikelyReaches } from '@/lib/citizen/geo';
import type { CitizenLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import type { WildfireDetails } from '@/types/domain';

// Regional haze travels far: Riau/Jambi/Sumatera Selatan fires routinely
// reach Batam, Pekanbaru or Singapore several hundred km away — well past
// the 6-hour plume the smoke map draws. Same range as smokeLikelyReaches.
const HAZE_RANGE_KM = 400;

export interface SmokeAdvisoryState {
  /** 'toward': fires in range and the wind carries their smoke here. */
  kind: 'toward' | 'nearby';
  hotspots: number;
  nearestKm: number;
  /** Compass direction from the citizen toward the nearest fires. */
  direction: string;
}

/**
 * A health advisory, separate from the hazard level: smoke from distant
 * fires isn't a disaster in this district (the level stays Normal), but it
 * can still make the air unhealthy. Estimated from NASA FIRMS hotspots and
 * the forecast wind — not an air-quality measurement.
 */
export function useSmokeAdvisory(location: CitizenLocation | null): SmokeAdvisoryState | null {
  const weather = usePublicWeather(location?.districtId);
  const { events } = useNationalEvents(location, weather.data);

  return useMemo(() => {
    const user = locationLatLng(location);
    if (!user) return null;
    const fires = events.filter(
      (item) => item.event.hazardType === 'wildfire' && item.km !== null && item.km <= HAZE_RANGE_KM,
    );
    if (fires.length === 0) return null;

    const nearest = fires.reduce((best, item) => ((item.km ?? Infinity) < (best.km ?? Infinity) ? item : best));
    const wind = weather.data;
    const toward = fires.some(
      (item) =>
        item.smokeTowardUser ||
        (!!wind &&
          smokeLikelyReaches(user.lat, user.lng, item.event.latitude, item.event.longitude, wind.windFromDeg, HAZE_RANGE_KM)),
    );
    const hotspots = fires.reduce(
      (sum, item) => sum + Math.max(1, (item.event.details as WildfireDetails | null)?.hotspotCount ?? 1),
      0,
    );

    return {
      kind: toward ? 'toward' : 'nearby',
      hotspots,
      nearestKm: nearest.km ?? 0,
      direction: compassName(bearingDeg(user.lat, user.lng, nearest.event.latitude, nearest.event.longitude)),
    };
  }, [events, location, weather.data]);
}

const TIPS = [
  'Pakai masker N95 atau KF94 saat di luar rumah. Masker kain dan masker bedah kurang menyaring asap.',
  'Kurangi aktivitas di luar, terutama anak, lansia, ibu hamil, dan penderita asma atau penyakit jantung.',
  'Tutup jendela dan pintu saat udara berbau asap atau tampak berkabut.',
];

export function SmokeAdvisory({ advisory }: { advisory: SmokeAdvisoryState }) {
  const toward = advisory.kind === 'toward';
  const where = `± ${formatDistance(advisory.nearestKm)} di arah ${advisory.direction}`;

  return (
    <section
      aria-label="Imbauan asap kebakaran hutan dan lahan"
      className={cn(
        'relative isolate grid gap-4 overflow-hidden rounded-3xl p-5 ring-1 sm:p-6',
        toward ? 'bg-lv-waspada-soft ring-lv-waspada/25' : 'bg-card/90 ring-border/60',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-12 w-12 shrink-0 place-items-center rounded-2xl',
            toward ? 'bg-lv-waspada text-white dark:text-background' : 'bg-muted text-muted-foreground',
          )}
        >
          <CloudFog className="h-6 w-6" />
        </span>
        <div className="grid min-w-0 gap-1">
          <span
            className={cn(
              'text-xs font-black tracking-[0.1em] uppercase',
              toward ? 'text-lv-waspada' : 'text-muted-foreground',
            )}
          >
            Imbauan kesehatan · Asap karhutla
          </span>
          <h2 className="text-lg leading-snug font-black text-balance sm:text-xl">
            {toward ? 'Asap kebakaran lahan bisa sampai ke wilayah Anda' : 'Ada kebakaran lahan di sekitar wilayah Anda'}
          </h2>
          <p className="text-[15px] text-foreground/80">
            {toward
              ? `${advisory.hotspots.toLocaleString('id-ID')} deteksi titik panas satelit ${where}, dan angin bertiup dari arah sana. Udara bisa berkabut dan tidak sehat.`
              : `${advisory.hotspots.toLocaleString('id-ID')} deteksi titik panas satelit ${where}. Angin saat ini tidak mengarah ke Anda, tetapi arah angin bisa berubah.`}
          </p>
        </div>
      </div>

      {toward ? (
        <ul className="grid gap-2">
          {TIPS.map((tip, index) => (
            <li key={tip} className="flex gap-3 rounded-2xl bg-card/70 px-3 py-2.5 text-[15px] dark:bg-white/5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lv-waspada text-xs font-black text-white dark:text-background">
                {index + 1}
              </span>
              {tip}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-muted/70 px-3 py-2.5 text-[15px]">
          Jika udara mulai berbau asap atau tampak berkabut, pakai masker N95 dan kurangi aktivitas di luar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href="/panduan?jenis=asap#masker"
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-extrabold transition-transform hover:-translate-y-0.5',
            toward ? 'bg-lv-waspada text-white dark:text-background' : 'bg-accent text-primary',
          )}
        >
          Cara memakai masker yang benar <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          href="/peta#asap"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-card/80 px-4 text-sm font-extrabold text-foreground ring-1 ring-border/70 transition-transform hover:-translate-y-0.5 dark:bg-white/5"
        >
          <MapIcon className="h-4 w-4" /> Lihat peta asap
        </Link>
      </div>

      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Perkiraan dari titik api satelit NASA FIRMS dan arah angin, bukan pengukuran kualitas udara. Status bencana wilayah
        Anda tetap mengikuti data BPBD.
      </p>
    </section>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowUp, ChevronDown, CircleCheck, Flame, Info, TriangleAlert } from 'lucide-react';
import { useAirQuality } from '@/hooks/use-air-quality';
import { formatTonnes, ISPU_META } from '@/lib/citizen/air-quality';
import { CITIZEN_SMOKE_COLORS } from '@/lib/chart-colors';
import { compassName, locationLatLng, locationSummary } from '@/lib/citizen/geo';
import { affectedDistricts, formatHours, MODEL_SMOKE_MAX_HOURS, reachForUser, type SmokePlume } from '@/lib/citizen/smoke';
import type { CitizenLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import type { District } from '@/types/domain';
import type { ModelSmoke } from '@/types/fire';
import { card } from './home-widgets';

export const SMOKE_HOURS = [
  { hours: 1, label: 'Sekarang' },
  { hours: 3, label: '3 jam' },
  { hours: 6, label: '6 jam' },
  { hours: 12, label: '12 jam' },
  { hours: 24, label: '24 jam' },
  { hours: 36, label: '36 jam' },
  { hours: 48, label: '48 jam' },
];

const MAX_LISTED = 8;

export function SmokeTimeSelector({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-bold text-muted-foreground">Perkiraan asap sampai ke mana dalam…</p>
      <div role="radiogroup" aria-label="Rentang waktu perkiraan asap" className="grid grid-cols-4 gap-1.5 rounded-2xl bg-muted p-1 sm:grid-cols-7">
        {SMOKE_HOURS.map((option) => (
          <button
            key={option.hours}
            type="button"
            role="radio"
            aria-checked={hours === option.hours}
            onClick={() => onChange(option.hours)}
            className={cn(
              'rounded-xl px-2 py-2 text-sm font-extrabold transition-colors',
              hours === option.hours ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hours > MODEL_SMOKE_MAX_HOURS && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Lebih dari 12 jam, sebaran asap hanya mengikuti prakiraan angin per jam, jadi makin jauh waktunya makin kurang pasti.
        </p>
      )}
    </div>
  );
}

/** The one question a citizen has: will the smoke reach me? */
export function SmokeAnswer({
  plumes,
  location,
  hours,
  onShowFire,
}: {
  plumes: SmokePlume[];
  location: CitizenLocation | null;
  hours: number;
  onShowFire: (fireId: string) => void;
}) {
  const user = locationLatLng(location);
  const hit = useMemo(() => {
    if (!user) return null;
    let best: { plume: SmokePlume; hours: number; thick: boolean } | null = null;
    for (const plume of plumes) {
      const reach = reachForUser(plume, user.lat, user.lng, hours);
      if (reach && (!best || reach.hours < best.hours)) best = { plume, ...reach };
    }
    return best;
  }, [plumes, user, hours]);

  if (!location || !user) {
    return (
      <p className={cn(card, 'text-sm text-muted-foreground')}>
        Pilih wilayah Anda di beranda untuk mengetahui apakah asap sampai ke tempat Anda.
      </p>
    );
  }
  const span = SMOKE_HOURS.find((option) => option.hours === hours)?.label.toLowerCase() ?? `${hours} jam`;

  if (!hit) {
    return (
      <section className={cn(card, 'flex gap-3 bg-lv-normal-soft')}>
        <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-lv-normal" />
        <div>
          <p className="text-lg font-black">Asap diperkirakan tidak sampai ke {locationSummary(location)}</p>
          <p className="text-sm text-foreground/80">
            Untuk {hours === 1 ? 'saat ini' : `${span} ke depan`}, berdasarkan model sebaran asap dan arah angin di lokasi
            titik api. Tetap cek lagi nanti karena angin bisa berubah.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={cn(card, 'grid gap-3 border-2 border-lv-waspada/60 bg-lv-waspada-soft')}>
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-lv-waspada" />
        <div>
          <p className="text-lg leading-snug font-black">
            Ya, asap bisa sampai ke {locationSummary(location)} {hit.hours < 1 ? 'sekarang' : `dalam ${formatHours(hit.hours)}`}
          </p>
          <p className="text-sm text-foreground/80">
            Dari titik api di <strong>{hit.plume.fire.label}</strong>, terbawa angin{' '}
            {hit.thick ? 'dengan asap cukup tebal' : 'sebagai asap tipis'}
            {hit.plume.kind === 'model' ? ' (model sebaran asap AETHER).' : '.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/panduan?jenis=asap#masker"
          className="rounded-xl bg-lv-waspada px-3 py-2 text-sm font-extrabold text-white dark:text-background"
        >
          Cara memakai masker
        </Link>
        <button
          type="button"
          onClick={() => onShowFire(hit.plume.fire.id)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-extrabold"
        >
          Lihat asal asapnya
        </button>
      </div>
    </section>
  );
}

/** CO2 the fire is emitting and the air at the fire, side by side. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1 px-3 first:pl-0 last:pr-0">
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[15px] leading-tight font-black">{children}</span>
    </div>
  );
}

/** Plain-language story for one fire: where it is, which way the smoke
 * goes and how far, and which kabupaten/kota it passes over, soonest
 * first. Emission and sensor details sit behind "Detail" so the card reads
 * in one glance. */
export function FireStory({
  plume,
  districts,
  userDistrictId,
}: {
  plume: SmokePlume;
  districts: District[];
  userDistrictId: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const areas = useMemo(() => affectedDistricts(plume, districts), [plume, districts]);
  const air = useAirQuality([{ lat: plume.fire.lat, lng: plume.fire.lng }]).data?.[0] ?? null;
  const airMeta = air?.ispu ? ISPU_META[air.ispu] : null;
  const co2 = plume.fire.co2TonnesPerHour;
  const toward = plume.wind
    ? (plume.wind.windFromDeg + 180) % 360
    : (plume.model?.transportBearingDeg ?? null);
  const listed = showAll ? areas : areas.slice(0, MAX_LISTED);
  const reachKm = Math.round(plume.centerline[plume.centerline.length - 1].km);
  const place = plume.fire.label.replace(/^(di )?sekitar /i, '');
  const sensorCount = plume.fire.sensors.length;

  return (
    <section className={cn(card, 'grid gap-4')}>
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lv-siaga-soft text-lv-siaga">
          <Flame className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">Titik api di sekitar</p>
          <h3 className="text-lg leading-snug font-black">{place}</h3>
          {plume.fire.hotspotCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {plume.fire.hotspotCount.toLocaleString('id-ID')} deteksi satelit
              {sensorCount > 0 && ` dari ${sensorCount} satelit`}
            </p>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border rounded-2xl bg-background px-4 py-3">
        <Fact label="Arah asap">
          {toward !== null ? (
            <>
              <ArrowUp className="h-4 w-4 shrink-0 text-primary" style={{ transform: `rotate(${toward}deg)` }} aria-hidden />
              <span className="truncate capitalize">{compassName(toward)}</span>
            </>
          ) : (
            'Tertahan'
          )}
        </Fact>
        <Fact label="Jangkauan">± {reachKm} km</Fact>
        <Fact label="Udara di api">
          {airMeta ? (
            <>
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', airMeta.solid)} aria-hidden />
              <span className={cn('truncate', airMeta.text)}>{airMeta.label}</span>
            </>
          ) : (
            <span className="text-muted-foreground">–</span>
          )}
        </Fact>
      </div>

      <p className="text-[15px] leading-snug text-foreground/85">
        {plume.wind ? (
          <>
            Angin dari {compassName(plume.wind.windFromDeg)} ({Math.round(plume.wind.windSpeedKmh)} km/jam)
            membawa asap sejauh ± {reachKm} km dalam {plume.hours === 1 ? '1 jam' : `${plume.hours} jam`}.
          </>
        ) : plume.model ? (
          <>
            Perkiraan model asap AETHER untuk pukul <strong>{format(new Date(plume.model.validAt), 'HH:mm')}</strong>
            {toward !== null ? `: sebagian besar asap dalam ± ${reachKm} km dari api.` : ': asap tertahan di sekitar api.'}
          </>
        ) : null}
      </p>

      <div className="grid gap-2">
        <p className="text-sm font-black">
          {areas.length > 0 ? `Wilayah yang bisa terkena asap (${areas.length})` : 'Asap belum sampai ke kabupaten/kota lain.'}
        </p>
        {areas.length > 0 && (
          <ul className="grid divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {listed.map((area) => {
              const mine = area.district.id === userDistrictId;
              return (
                <li
                  key={area.district.id}
                  className={cn('flex items-center justify-between gap-3 px-3 py-2.5 text-sm', mine && 'bg-lv-waspada-soft')}
                >
                  <span className={cn('min-w-0 truncate', mine ? 'font-extrabold' : 'font-bold')}>
                    {area.district.name}
                    {mine && ' (wilayah Anda)'}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground tabular-nums">
                    <span className={cn('flex items-center gap-1', area.thick && 'text-lv-siaga')}>
                      <span
                        className={cn('h-2 w-2 rounded-full', area.thick ? 'bg-lv-siaga' : 'bg-muted-foreground/40')}
                        aria-hidden
                      />
                      {area.thick ? 'Tebal' : 'Tipis'}
                    </span>
                    <span>{area.hours < 1 ? 'sekarang' : formatHours(area.hours)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {areas.length > MAX_LISTED && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="justify-self-start text-sm font-extrabold text-primary">
            {showAll ? 'Tampilkan lebih sedikit' : `Tampilkan ${areas.length - MAX_LISTED} lainnya`}
          </button>
        )}
      </div>

      <details className="group rounded-2xl bg-background px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-extrabold text-muted-foreground [&::-webkit-details-marker]:hidden">
          Detail emisi & sumber data
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="mt-3 grid gap-2">
          {co2 !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Emisi saat satelit melintas</dt>
              <dd className="font-bold tabular-nums">± {formatTonnes(co2)} ton CO₂/jam</dd>
            </div>
          )}
          {air && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Kualitas udara di api</dt>
              <dd className="text-right font-bold tabular-nums">
                PM2.5 {Math.round(air.pm25 ?? 0)} µg/m³
                {air.carbonDioxidePpm != null && ` · CO₂ ${air.carbonDioxidePpm} ppm`}
              </dd>
            </div>
          )}
          {sensorCount > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Satelit</dt>
              <dd className="text-right font-bold">{plume.fire.sensors.join(', ')}</dd>
            </div>
          )}
          {plume.model && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Perkiraan asap dibuat</dt>
              <dd className="font-bold tabular-nums">pukul {format(new Date(plume.model.issuedAt), 'HH:mm')}</dd>
            </div>
          )}
        </dl>
        {co2 !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Emisi dihitung dari daya radiasi api (FRP) satelit NASA FIRMS pada lintasan terkuat: laju sesaat, bukan total
            harian. Kebakaran gambut yang membara tanpa nyala besar bisa tercatat lebih rendah dari sebenarnya.
          </p>
        )}
      </details>
    </section>
  );
}

export function SmokeLegend({ modelRun = null }: { modelRun?: ModelSmoke['run'] }) {
  // Matches the smoke drawn on the satellite basemap (citizen-map.tsx).
  const color = CITIZEN_SMOKE_COLORS.dark;
  const modelLive = modelRun !== null && !modelRun.stale;
  return (
    <section className={cn(card, 'grid gap-3 text-sm')}>
      <h2 className="text-lg font-black">Cara membaca peta asap</h2>
      <div className="flex items-center gap-3">
        <span className="h-4 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${color}bb, ${color}33)` }} />
        Asap tebal di dekat api, makin tipis makin jauh
      </div>
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#e8590c] text-white">
          <Flame className="h-3.5 w-3.5" />
        </span>
        Titik api (ketuk untuk penjelasan)
      </div>
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[#1b2640] shadow">
          <ArrowUp className="h-3.5 w-3.5" />
        </span>
        Arah angin membawa asap
      </div>
      <p className="flex gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {modelLive && (
            <>
              Asap berbentuk kotak-kotak: model sebaran asap AETHER untuk titik api terbesar (perkiraan dibuat pukul{' '}
              {format(new Date(modelRun.issuedAt), 'HH:mm')}). Lebih pekat berarti lebih banyak asap yang diperkirakan di sana,
              bukan ukuran kualitas udara.{' '}
            </>
          )}
          {modelLive ? 'Asap berbentuk gumpalan halus' : 'Sebaran asap'} adalah perkiraan sederhana dari arah dan kecepatan
          angin (Open-Meteo) di lokasi titik api (NASA FIRMS: MODIS dan VIIRS). Hujan, bentang alam, dan perubahan angin bisa
          membuat sebaran sebenarnya berbeda.
        </span>
      </p>
    </section>
  );
}

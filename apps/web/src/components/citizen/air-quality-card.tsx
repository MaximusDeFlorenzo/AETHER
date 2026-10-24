'use client';

import { format } from 'date-fns';
import { Info, Loader2, RadioTower, Wind } from 'lucide-react';
import { useAirQuality, useNearestStation } from '@/hooks/use-air-quality';
import { ISPU_META, ispuFor } from '@/lib/citizen/air-quality';
import { cn } from '@/lib/utils';
import type { PointAirQuality } from '@/types/air-quality';
import { card } from './home-widgets';

const num = (value: number | null, digits = 0) =>
  value === null ? '–' : value.toLocaleString('id-ID', { maximumFractionDigits: digits });

/** PM2.5 for the next 24 h, one bar per 2 hours, coloured by ISPU. */
function Pm25Bars({ hourly }: { hourly: PointAirQuality['hourly'] }) {
  const slots = hourly.filter((_, index) => index % 2 === 0).slice(0, 12);
  const values = slots.map((slot) => slot.pm25 ?? 0);
  const top = Math.max(...values, 60);
  if (!slots.length) return null;
  return (
    <div className="grid h-24 grid-cols-12 items-end gap-1.5" role="img" aria-label="Perkiraan PM2.5 24 jam ke depan">
      {slots.map((slot) => (
        <div key={slot.time} className="grid h-full content-end justify-items-center gap-1">
          <span
            title={`${num(slot.pm25)} µg/m³`}
            className={cn(
              'w-full max-w-6 rounded-t-md rounded-b-sm',
              slot.pm25 === null ? 'bg-muted' : ISPU_META[ispuFor(slot.pm25)].solid,
            )}
            style={{ height: `${Math.max(4, ((slot.pm25 ?? 0) / top) * 100) * 0.8}%` }}
          />
          <span className="font-mono text-[10px] text-muted-foreground">{format(new Date(slot.time), 'HH')}</span>
        </div>
      ))}
    </div>
  );
}

/** Air quality at one point: ISPU category, pollutants and a 24 h PM2.5
 * outlook. With `withStation`, a measured reading from the nearest active
 * OpenAQ station (≤ 25 km) leads when there is one; the model fills the rest. */
export function AirQualityCard({
  point,
  title,
  subtitle,
  withStation = false,
}: {
  point: { lat: number; lng: number };
  title: string;
  subtitle?: string;
  withStation?: boolean;
}) {
  const { data, isLoading } = useAirQuality([point]);
  const stationQuery = useNearestStation(withStation ? point : null);
  const air = data?.[0] ?? null;
  const station = stationQuery.data?.ispu ? stationQuery.data : null;

  if (isLoading || (withStation && stationQuery.isLoading)) {
    return (
      <section className={cn(card, 'flex items-center gap-3 text-sm text-muted-foreground')}>
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat kualitas udara…
      </section>
    );
  }
  const ispu = station?.ispu ?? air?.ispu;
  if (!ispu) return null;
  const meta = ISPU_META[ispu];
  const pm25 = station?.pm25 ?? air?.pm25 ?? null;
  const pm10 = station?.pm10 ?? air?.pm10 ?? null;

  return (
    <section className={cn(card, 'grid gap-4')}>
      <div className="flex items-center gap-3">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', meta.soft, meta.text)}>
          <Wind className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-black">{title}</h2>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <div className={cn('grid gap-1 rounded-2xl px-4 py-3', meta.soft)}>
        <p className={cn('text-2xl font-black', meta.text)}>{meta.label}</p>
        <p className="text-sm text-foreground/80">{meta.advice}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-foreground/70">
          {station ? (
            <>
              <RadioTower className="h-3.5 w-3.5 shrink-0" />
              Terukur di {station.isMonitor ? 'stasiun pemantau' : 'sensor'} {station.name} ({station.provider}), ±{' '}
              {num(station.distanceKm, 1)} km, pukul {format(new Date(station.measuredAt), 'HH.mm')}
            </>
          ) : (
            'Perkiraan model, tidak ada stasiun aktif dalam 25 km'
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        {[
          [station?.pm25 != null ? 'PM2.5 (terukur)' : 'PM2.5', `${num(pm25)} µg/m³`],
          [station?.pm10 != null ? 'PM10 (terukur)' : 'PM10', `${num(pm10)} µg/m³`],
          ['Karbon monoksida (CO)', `${num(air?.carbonMonoxide == null ? null : air.carbonMonoxide / 1000, 1)} mg/m³`],
          ['CO₂ di udara', `${num(air?.carbonDioxidePpm ?? null)} ppm`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-background px-3 py-2">
            <dt className="text-xs font-bold text-muted-foreground">{label}</dt>
            <dd className="font-black tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {air && (
        <div className="grid gap-1.5">
          <p className="text-sm font-bold text-muted-foreground">PM2.5 24 jam ke depan (perkiraan model)</p>
          <Pm25Bars hourly={air.hourly} />
        </div>
      )}

      <p className="flex gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {station &&
            `Angka terukur dari ${station.isMonitor ? 'stasiun pemantau' : 'sensor berbiaya rendah'} lewat OpenAQ${station.isMonitor ? '' : ', bisa sedikit berbeda dari stasiun resmi'}. `}
          {air &&
            `${station ? 'CO, CO₂ dan prakiraan' : 'Semua angka'} dari model CAMS (Copernicus) lewat Open-Meteo, grid ± 40 km, bukan hasil pengukuran. `}
          Kategori memakai batas PM2.5 ISPU (Permen LHK P.14/2020).
        </span>
      </p>
    </section>
  );
}

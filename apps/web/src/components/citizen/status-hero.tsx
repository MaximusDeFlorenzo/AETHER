'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Share2, ShieldCheck } from 'lucide-react';
import { eventTitle, timeAgo } from '@/lib/citizen/events';
import { HAZARD_NOUN, LEVEL_META, LEVEL_ORDER, statusCopy, type RegionStatus } from '@/lib/citizen/status';
import type { CitizenLevel } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { ContourCanvas } from './contour-canvas';
import { HazardIcon } from './hazard-icon';
import { InstallAppButton } from './install-app-button';

/** 1.13, 104.05 → "1°08′ LU · 104°03′ BT" — how Indonesian maps label a spot. */
function formatPoint([lng, lat]: [number, number]) {
  const part = (value: number, positive: string, negative: string) => {
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = Math.round((abs - degrees) * 60);
    return `${degrees}°${String(minutes).padStart(2, '0')}′ ${value >= 0 ? positive : negative}`;
  };
  return `${part(lat, 'LU', 'LS')} · ${part(lng, 'BT', 'BB')}`;
}

const GAUGE = { cx: 120, cy: 126, r: 92 };

function arcPoint(deg: number) {
  const angle = ((180 + deg) * Math.PI) / 180;
  return [GAUGE.cx + GAUGE.r * Math.cos(angle), GAUGE.cy + GAUGE.r * Math.sin(angle)];
}

/** Half-dial over the four BNPB levels; the needle sits on the current one. */
function LevelGauge({ level }: { level: CitizenLevel }) {
  const current = LEVEL_ORDER.indexOf(level);
  return (
    <div className="hidden justify-items-center gap-1 sm:grid">
      <svg
        viewBox="0 0 240 150"
        className="h-auto w-full max-w-[260px]"
        role="img"
        aria-label={`Tingkat bahaya: ${LEVEL_META[level].label}, level ${current + 1} dari 4`}
      >
        {LEVEL_ORDER.map((step, index) => {
          const [x0, y0] = arcPoint(index * 45 + 2);
          const [x1, y1] = arcPoint((index + 1) * 45 - 2);
          return (
            <path
              key={step}
              d={`M${x0} ${y0} A ${GAUGE.r} ${GAUGE.r} 0 0 1 ${x1} ${y1}`}
              stroke={`var(--lv-${step})`}
              strokeOpacity={index <= current ? 1 : 0.25}
              strokeWidth={16}
              strokeLinecap="round"
              fill="none"
            />
          );
        })}
        <path
          d="M117 126 L120 50 L123 126 Z"
          fill="#ffffff"
          className="transition-transform duration-700 ease-[cubic-bezier(.3,1.4,.5,1)]"
          style={{ transformOrigin: '120px 126px', transform: `rotate(${current * 45 - 67.5}deg)` }}
        />
        <circle cx={GAUGE.cx} cy={GAUGE.cy} r={9} fill="#ffffff" />
        <circle cx={GAUGE.cx} cy={GAUGE.cy} r={4} fill="var(--navy-dark)" />
        <text x={22} y={146} fill="rgba(255,255,255,0.6)" fontSize={10} fontWeight={800}>
          Normal
        </text>
        <text x={218} y={146} fill="rgba(255,255,255,0.6)" fontSize={10} fontWeight={800} textAnchor="end">
          Awas
        </text>
      </svg>
      <p className="text-center text-xs text-white/60">
        Skala 4 tingkat BNPB
        <br />
        {LEVEL_ORDER.map((step) => LEVEL_META[step].label).join(' · ')}
      </p>
    </div>
  );
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'AETHER Siaga', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Share sheet dismissed or clipboard refused: nothing to undo.
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex min-h-10 items-center gap-2 rounded-2xl px-4 text-sm font-extrabold text-white ring-1 sm:min-h-11 ring-white/20 transition-colors hover:bg-white/10"
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied ? 'Tersalin' : 'Bagikan ke keluarga'}
    </button>
  );
}

export function StatusHero({
  status,
  areaName,
  point = null,
  smokeNearby = false,
}: {
  status: RegionStatus;
  areaName: string;
  /** District reference point [lng, lat], shown as map coordinates. */
  point?: [number, number] | null;
  /** Fires within haze range: still Normal (no disaster here), but not "aman". */
  smokeNearby?: boolean;
}) {
  const meta = LEVEL_META[status.level];
  const base = statusCopy(status, areaName);
  const copy =
    smokeNearby && status.level === 'normal'
      ? {
          ...base,
          headline: 'Tidak ada bencana di wilayah Anda',
          body: `Tidak ada peringatan bencana aktif untuk ${areaName} dalam 24 jam terakhir. Namun ada kebakaran lahan di sekitar wilayah Anda yang asapnya bisa terbawa angin, lihat imbauan di bawah.`,
        }
      : base;
  const guideHref =
    status.level !== 'normal' && status.guideKey ? `/panduan?jenis=${status.guideKey}` : '#persiapan';

  return (
    <section
      aria-live="polite"
      className="theme-dark relative isolate overflow-hidden rounded-3xl bg-navy-dark p-4 text-foreground sm:rounded-[32px] shadow-[0_24px_50px_-28px_rgba(8,27,58,0.9)] sm:p-8"
    >
      <ContourCanvas className="absolute inset-0 -z-10 h-full w-full" />
      <div
        aria-hidden
        className={cn('absolute -top-40 -right-32 -z-10 h-[26rem] w-[26rem] rounded-full opacity-30 blur-[80px] transition-colors duration-700', meta.solid)}
      />

      <InstallAppButton className="absolute top-3 right-3 sm:top-5 sm:right-5" />

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-center">
        <div className="grid min-w-0 content-start gap-3 pr-11 sm:gap-4 sm:pr-0">
          <span className="inline-flex items-center gap-2 justify-self-start rounded-full bg-white/10 px-3 py-1 text-xs font-extrabold text-white/80">
            <span className="relative flex h-2 w-2">
              <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', meta.solid)} />
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', meta.solid)} />
            </span>
            Status bahaya {areaName} · langsung
          </span>

          <div className="flex items-center gap-3">
            <span
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-navy-dark sm:h-14 sm:w-14 sm:rounded-2xl',
                meta.solid,
                status.level !== 'normal' && 'citizen-radar',
              )}
              aria-hidden
            >
              {status.level === 'normal' ? (
                <ShieldCheck className="h-5 w-5 sm:h-7 sm:w-7" />
              ) : (
                <HazardIcon hazardType={status.hazardType} alertHazard={status.alertHazard} className="h-5 w-5 sm:h-7 sm:w-7" />
              )}
            </span>
            <span className={cn('text-4xl leading-[0.95] font-black tracking-[-0.035em] sm:text-6xl', meta.text)}>
              {copy.tag}
            </span>
          </div>

          <div className="grid gap-1.5 sm:gap-2">
            <h1 className="text-xl leading-tight font-black tracking-tight text-balance text-white sm:text-[1.75rem]">
              {copy.headline}
            </h1>
            <p className="max-w-[52ch] text-sm leading-relaxed text-white/75 sm:text-base">{copy.body}</p>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-2.5">
            {status.alert ? (
              <Link
                href={`/peringatan/${status.alert.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-alarm px-4 font-black text-white shadow-[0_10px_24px_-10px_var(--alarm)] transition-transform hover:-translate-y-0.5"
              >
                Buka layar peringatan <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                href={guideHref}
                className="inline-flex min-h-10 items-center gap-2 rounded-2xl bg-white px-4 text-sm sm:min-h-11 font-extrabold text-navy-dark transition-transform hover:-translate-y-0.5"
              >
                {status.level === 'normal' ? 'Lihat persiapan' : 'Lihat panduan'} <ChevronRight className="h-4 w-4" />
              </Link>
            )}
            <ShareButton text={`Status ${areaName} di AETHER Siaga: ${copy.tag}. ${copy.headline}.`} />
          </div>
        </div>

        <LevelGauge level={status.level} />
      </div>

      {status.event && (
        <Link
          href={`/kejadian/${status.event.id}`}
          className="citizen-lift mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white/8 px-4 py-3 text-sm sm:mt-5 font-bold ring-1 ring-white/10 backdrop-blur hover:bg-white/12"
        >
          <span className="min-w-0">
            <span className="block truncate">{eventTitle(status.event)}</span>
            <span className="block text-xs font-semibold text-muted-foreground">{timeAgo(status.event.eventTime)}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {status.proneTo.length > 0 && (
        <p className="mt-3 text-xs text-white/70 sm:mt-4 sm:text-sm">
          Catatan: wilayah Anda termasuk rawan{' '}
          <strong className="text-white">{status.proneTo.map((type) => HAZARD_NOUN[type]).join(' dan ')}</strong>{' '}
          berdasarkan data risiko jangka panjang.
        </p>
      )}

      {point && (
        <span aria-hidden className="pointer-events-none absolute right-5 bottom-3 hidden font-mono text-[11px] text-white/40 sm:block">
          {formatPoint(point)}
        </span>
      )}
    </section>
  );
}

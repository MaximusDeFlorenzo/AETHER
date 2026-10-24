'use client';

import { useEffect, useId, useState } from 'react';
import { format } from 'date-fns';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEP_MS = 1600;

interface KarhutlaTimelineProps {
  horizons: number[];
  activeHorizon: number;
  issuedAt: string | null;
  onChange: (horizonHours: number) => void;
}

/** Horizon scrubber with a play button that steps through the forecast horizons. */
export function KarhutlaTimeline({ horizons, activeHorizon, issuedAt, onChange }: KarhutlaTimelineProps) {
  const sliderId = useId();
  const [playing, setPlaying] = useState(false);
  const index = Math.max(0, horizons.indexOf(activeHorizon));
  const validAt = issuedAt ? new Date(new Date(issuedAt).getTime() + activeHorizon * 3_600_000) : null;

  useEffect(() => {
    if (!playing || horizons.length < 2) return;
    const timer = setTimeout(() => onChange(horizons[(index + 1) % horizons.length]), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index, horizons, onChange]);

  if (!horizons.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        disabled={horizons.length < 2}
        aria-label={playing ? 'Pause horizon playback' : 'Play through forecast horizons'}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>

      <div className="min-w-[220px] flex-1 space-y-1.5">
        <label htmlFor={sliderId} className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
          <span className="font-medium">Forecast horizon</span>
          {validAt && (
            <span>
              valid <strong className="font-semibold text-foreground tabular-nums">{format(validAt, 'dd MMM HH:mm')}</strong>
            </span>
          )}
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={horizons.length - 1}
          step={1}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            onChange(horizons[Number(e.target.value)]);
          }}
          aria-valuetext={`+${activeHorizon} hours`}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          {horizons.map((h) => (
            <span key={h}>+{h} h</span>
          ))}
        </div>
      </div>

      <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Forecast horizon">
        {horizons.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={h === activeHorizon}
            onClick={() => {
              setPlaying(false);
              onChange(h);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors',
              h === activeHorizon ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            +{h} h
          </button>
        ))}
      </div>
    </div>
  );
}

import { KARHUTLA_STYLES, SMOKE_OPACITY } from './karhutla-utils';

function Item({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex w-5 shrink-0 justify-center">{swatch}</span>
      {label}
    </li>
  );
}

/** Map key, split so observation and model output never read as one thing. */
export function KarhutlaLegend() {
  return (
    <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Observed</p>
        <ul className="space-y-1.5">
          <Item
            swatch={<span className="h-2.5 w-2.5 rounded-full border border-orange-900" style={{ background: KARHUTLA_STYLES.hotspot }} />}
            label="Satellite hotspot (FIRMS)"
          />
          <Item
            swatch={<span className="h-2.5 w-4 border-2" style={{ borderColor: KARHUTLA_STYLES.footprint }} />}
            label="Hotspot pixel footprint"
          />
        </ul>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Model output</p>
        <ul className="space-y-1.5">
          <Item
            swatch={
              <span
                className="h-2.5 w-4 border-2 border-dashed"
                style={{ borderColor: KARHUTLA_STYLES.spread, background: `${KARHUTLA_STYLES.spread}24` }}
              />
            }
            label="Potential spread (upper bound)"
          />
          <Item
            swatch={
              <span className="flex h-2.5 w-4 overflow-hidden rounded-sm border border-zinc-400/60">
                {(['core', 'likely', 'possible'] as const).map((l) => (
                  <span key={l} className="flex-1 bg-zinc-400" style={{ opacity: SMOKE_OPACITY[l] * 1.8 }} />
                ))}
              </span>
            }
            label="Smoke: core / likely / possible"
          />
          <Item swatch={<span className="h-0.5 w-4" style={{ background: KARHUTLA_STYLES.wind }} />} label="Wind 10 m (NWP forecast)" />
        </ul>
      </div>
      <p className="text-[11px] text-muted-foreground sm:col-span-2">
        Smoke classes show where simulated particles are densest — qualitative, not a PM2.5 or ISPU concentration.
      </p>
    </div>
  );
}

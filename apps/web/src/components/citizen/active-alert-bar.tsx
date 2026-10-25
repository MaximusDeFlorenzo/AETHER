'use client';

import Link from 'next/link';
import { LifeBuoy, TriangleAlert } from 'lucide-react';
import { useActiveAlerts } from '@/hooks/use-public-alerts';
import { ALERT_LEVEL_TONE, alertLevelOf } from '@/lib/citizen/alert-level';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';

/**
 * Stays under the header for as long as an alarm for the citizen's area is
 * active — including after they skipped the full-screen alarm to silence it.
 * Someone already on the way to the assembly point can still reopen the
 * instructions or ask for help (which sends their location) in one tap.
 */
export function ActiveAlertBar() {
  const location = useCitizenStore((state) => state.location);
  const { data } = useActiveAlerts(location);
  const active = (data ?? []).filter((alert) => alert.isActive);
  if (active.length === 0) return null;

  return (
    <div className="grid">
      {active.map((alert) => {
        const tone = ALERT_LEVEL_TONE[alertLevelOf(alert)];
        return (
          <div key={alert.id} role="alert" className={cn('text-white', tone.bg)}>
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8 2xl:px-10">
              <Link href={`/peringatan/${alert.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                <TriangleAlert className="h-5 w-5 shrink-0" />
                <span className="min-w-0 truncate text-sm font-black">
                  {tone.label} · {alert.title}
                  <span className="hidden font-bold opacity-90 sm:inline"> — {alert.action}</span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/peringatan/${alert.id}`}
                  className="rounded-full border border-white/70 px-3 py-1 text-xs font-black hover:bg-white/15"
                >
                  Lihat
                </Link>
                <Link
                  href={`/peringatan/${alert.id}?bantuan=1`}
                  className={cn('inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-black', tone.text)}
                >
                  <LifeBuoy className="h-3.5 w-3.5" /> Butuh bantuan
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePendingHelp } from '@/hooks/use-public-alerts';

const SEEN_KEY = 'aether-help-requests-seen';

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Pops up once whenever there are more citizens waiting for help than this
 * officer has already seen (per alarm, remembered in the browser). Skipping
 * it is fine — the red badge on "Warga Butuh Bantuan" stays until each
 * request is marked safe or evacuated.
 */
export function HelpRequestPopup() {
  const pathname = usePathname();
  const router = useRouter();
  const { alerts, total } = usePendingHelp();
  const [open, setOpen] = useState(false);
  const signature = alerts.map((alert) => `${alert.id}:${alert.responses.needsHelp}`).join('|');

  useEffect(() => {
    if (total === 0 || pathname.startsWith('/help-requests')) return;
    const seen = readSeen();
    if (alerts.some((alert) => alert.responses.needsHelp > (seen[alert.id] ?? 0))) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the counts change
  }, [signature, pathname]);

  if (!open) return null;

  const markSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(alerts.map((alert) => [alert.id, alert.responses.needsHelp]))));
    } catch {
      // Storage blocked — it may show again on the next count change.
    }
    setOpen(false);
  };
  const areas = alerts
    .map((alert) => alert.area.villageName ?? alert.area.subdistrictName ?? alert.area.districtName)
    .filter((area, index, all) => all.indexOf(area) === index)
    .join(', ');

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="help-popup-title" className="grid w-full max-w-sm gap-4 rounded-2xl bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-alarm text-white motion-safe:animate-pulse">
            <LifeBuoy className="h-6 w-6" />
          </span>
          <div>
            <h2 id="help-popup-title" className="text-lg font-bold">
              {total} warga butuh bantuan
            </h2>
            <p className="text-sm text-muted-foreground">{areas}</p>
          </div>
        </div>
        <p className="text-sm">Lihat lokasi terbaru, kondisi, dan nomor yang bisa dihubungi, lalu kirim bantuan.</p>
        <div className="grid gap-2">
          <Button
            className="bg-alarm text-white hover:bg-alarm/90"
            onClick={() => {
              markSeen();
              router.push('/help-requests');
            }}
          >
            Lihat sekarang
          </Button>
          <Button variant="ghost" onClick={markSeen}>
            Nanti
          </Button>
        </div>
      </div>
    </div>
  );
}

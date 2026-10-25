'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { LifeBuoy, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { HelpRequests } from '@/components/public-alerts/help-requests';
import { useOperatorAlerts } from '@/hooks/use-public-alerts';
import { ALERT_LEVEL_TONE, alertLevelOf } from '@/lib/citizen/alert-level';
import { cn } from '@/lib/utils';

/** Every active alarm that has citizens asking for help, waiting ones first. */
export default function HelpRequestsPage() {
  const { data, isLoading } = useOperatorAlerts();
  const alerts = (data?.data ?? [])
    .filter(
      (alert) =>
        alert.isActive &&
        alert.responses.needsHelp + (alert.responses.helpDispatched ?? 0) + (alert.responses.helpResolved ?? 0) > 0,
    )
    .sort((a, b) => b.responses.needsHelp - a.responses.needsHelp);
  const waiting = alerts.reduce((sum, alert) => sum + alert.responses.needsHelp, 0);
  const dispatched = alerts.reduce((sum, alert) => sum + (alert.responses.helpDispatched ?? 0), 0);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6">
      <PageHeader
        icon={LifeBuoy}
        title="Warga Butuh Bantuan"
        description="Warga yang menekan “Butuh bantuan” pada peringatan aktif: lokasi terbaru, kondisi, dan nomor yang bisa dihubungi. Tandai “Petugas dikerahkan” saat tim berangkat, lalu “Sudah aman / dievakuasi” setelah selesai."
      />

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Tidak ada permintaan bantuan pada peringatan yang sedang aktif.
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm">
            {waiting > 0 && <span className="font-semibold text-alarm">{waiting} menunggu ditangani. </span>}
            {dispatched > 0 && <span className="font-semibold text-lv-siaga">{dispatched} petugas sedang dikerahkan. </span>}
            {waiting === 0 && dispatched === 0 && <span className="text-muted-foreground">Semua warga sudah aman / dievakuasi.</span>}
          </p>
          {alerts.map((alert) => {
            const tone = ALERT_LEVEL_TONE[alertLevelOf(alert)];
            const area = [alert.area.villageName, alert.area.subdistrictName && `Kec. ${alert.area.subdistrictName}`, alert.area.districtName]
              .filter(Boolean)
              .join(', ');
            return (
              <Card key={alert.id}>
                <CardHeader className="gap-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Badge className={cn('text-white', tone.bg)}>{tone.label}</Badge>
                    {alert.title}
                    {alert.responses.needsHelp > 0 && (
                      <Badge className="bg-alarm text-white">{alert.responses.needsHelp} menunggu</Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {area} · dikirim {format(new Date(alert.createdAt), 'd MMM HH.mm', { locale: localeId })} ·{' '}
                    <Link href="/public-alerts" className="text-primary">
                      Lihat peringatan
                    </Link>
                  </p>
                </CardHeader>
                <CardContent>
                  <HelpRequests alert={alert} />
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

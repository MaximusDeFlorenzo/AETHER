'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { formatDistanceToNowStrict } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { CircleCheck, ExternalLink, Loader2, Phone, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAlertResponses, useHelpHandling } from '@/hooks/use-public-alerts';
import { googleMapsDirectionsUrl } from '@/lib/citizen/geo';
import type { HelpRequestHandling, OperatorPublicAlert, PublicAlertResponses } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';

// react-leaflet touches `window` at import time — client-only.
const HelpRequestsMap = dynamic(
  () => import('@/components/public-alerts/help-requests-map').then((mod) => mod.HelpRequestsMap),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted" /> },
);

type HelpRequest = PublicAlertResponses['needsHelp'][number];

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: localeId });

/** Map + list of one alarm's "Butuh bantuan" requests, in three stages:
 * waiting (red, counted in the sidebar badge) → petugas dikerahkan (orange,
 * still on the map) → sudah aman / dievakuasi (folded away). */
export function HelpRequests({ alert }: { alert: OperatorPublicAlert }) {
  const { data, isLoading } = useAlertResponses(alert.id);
  const setHandling = useHelpHandling();
  const [pendingId, setPendingId] = useState<string | null>(null);
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!data || data.needsHelp.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada permintaan bantuan.</p>;
  }

  const waiting = data.needsHelp.filter((request) => !request.handling);
  const dispatched = data.needsHelp.filter((request) => request.handling === 'dispatched');
  const resolved = data.needsHelp.filter((request) => request.handling === 'resolved');
  // One numbering for map and list: waiting first, then dispatched.
  const active = [...waiting, ...dispatched];
  const destination =
    alert.destinationLatitude !== null && alert.destinationLongitude !== null
      ? { name: alert.destinationName ?? 'Tujuan evakuasi', lat: alert.destinationLatitude, lng: alert.destinationLongitude }
      : null;
  const anyLocated = active.some((request) => request.latitude !== null && request.longitude !== null);

  const mark = (responseId: string, handling: HelpRequestHandling) => {
    setPendingId(responseId);
    setHandling.mutate({ alertId: alert.id, responseId, handling }, { onSettled: () => setPendingId(null) });
  };

  const row = (request: HelpRequest, index: number) => {
    const isDispatched = request.handling === 'dispatched';
    return (
      <li
        key={request.id}
        className={cn('grid gap-1.5 rounded-lg border-l-4 bg-muted px-3 py-2', isDispatched ? 'border-lv-siaga' : 'border-alarm')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            #{index + 1}
            {request.peopleCount !== null && ` · ${request.peopleCount} orang`}
            <span className="font-normal text-muted-foreground"> · minta bantuan {ago(request.createdAt)}</span>
          </span>
          {request.latitude !== null && request.longitude !== null ? (
            <a
              href={googleMapsDirectionsUrl(request.latitude, request.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary"
            >
              Rute · lokasi {ago(request.updatedAt)} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground">Lokasi tidak dibagikan</span>
          )}
        </div>
        {request.note && <p>{request.note}</p>}
        {isDispatched && (
          <p className="text-xs font-semibold text-lv-siaga">
            <Truck className="mr-1 inline h-3.5 w-3.5" />
            Petugas dikerahkan {request.handledAt ? ago(request.handledAt) : ''}
            {request.handledByName ? ` · ${request.handledByName}` : ''}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {request.contactPhone && (
            <a
              href={`tel:${request.contactPhone.replace(/[^\d+]/g, '')}`}
              className="mr-auto inline-flex items-center gap-1 font-medium text-primary"
            >
              <Phone className="h-3.5 w-3.5" /> {request.contactPhone}
            </a>
          )}
          {!isDispatched && (
            <Button
              size="sm"
              variant="outline"
              disabled={pendingId === request.id}
              onClick={() => mark(request.id, 'dispatched')}
              className={cn(!request.contactPhone && 'ml-auto')}
            >
              <Truck className="h-3.5 w-3.5" /> Petugas dikerahkan
            </Button>
          )}
          <Button
            size="sm"
            variant={isDispatched ? 'default' : 'outline'}
            disabled={pendingId === request.id}
            onClick={() => mark(request.id, 'resolved')}
            className={cn(isDispatched && !request.contactPhone && 'ml-auto')}
          >
            <CircleCheck className="h-3.5 w-3.5" /> Sudah aman / dievakuasi
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="grid gap-3">
      {anyLocated && (
        <div className="h-72 overflow-hidden rounded-xl border border-border">
          <HelpRequestsMap requests={active} destination={destination} />
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">Semua warga sudah aman / dievakuasi.</p>
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="grid gap-1.5">
              <h4 className="text-xs font-bold tracking-wide text-alarm uppercase">Menunggu ({waiting.length})</h4>
              <ol className="grid gap-1.5 text-sm">{waiting.map((request, index) => row(request, index))}</ol>
            </section>
          )}
          {dispatched.length > 0 && (
            <section className="grid gap-1.5">
              <h4 className="text-xs font-bold tracking-wide text-lv-siaga uppercase">
                Petugas sedang dikerahkan ({dispatched.length})
              </h4>
              <ol className="grid gap-1.5 text-sm">
                {dispatched.map((request, index) => row(request, waiting.length + index))}
              </ol>
            </section>
          )}
        </>
      )}

      {resolved.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Sudah aman / dievakuasi ({resolved.length})</summary>
          <ul className="mt-1.5 grid gap-1">
            {resolved.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
                <span>
                  {request.peopleCount !== null ? `${request.peopleCount} orang` : 'Warga'}
                  {request.note && <span className="text-muted-foreground"> · {request.note}</span>}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-lv-normal">
                  <CircleCheck className="h-3.5 w-3.5" /> Aman / dievakuasi
                  {request.handledAt && <span className="font-normal text-muted-foreground"> · {ago(request.handledAt)}</span>}
                  {request.handledByName && <span className="font-normal text-muted-foreground"> · {request.handledByName}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

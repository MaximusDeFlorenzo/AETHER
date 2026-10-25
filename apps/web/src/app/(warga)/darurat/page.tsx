'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Flag, Loader2, LocateFixed, MapPin, Phone, Tent } from 'lucide-react';
import { useLocationPicker } from '@/components/citizen/citizen-shell';
import { card, EmergencyNumbers } from '@/components/citizen/home-widgets';
import { PageContainer, PageHeading, SectionTitle } from '@/components/citizen/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { useShelters } from '@/hooks/use-resource-plans';
import { distanceKm, formatDistance, googleMapsDirectionsUrl, locationLatLng, locationSummary } from '@/lib/citizen/geo';
import { shelterLatLng, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';

function Shelters() {
  const location = useCitizenStore((state) => state.location);
  const { openPicker } = useLocationPicker();
  const shelters = useShelters(location?.districtId);
  // Distances start from the picked area's reference point; "Pakai lokasi
  // saya" swaps in the phone's GPS for a true nearest-first order.
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsFailed, setGpsFailed] = useState(false);
  const origin = gps ?? locationLatLng(location);

  const sorted = useMemo(() => {
    const rows = (shelters.data ?? []).map((shelter) => {
      const point = shelterLatLng(shelter);
      const km = point && origin ? distanceKm(origin.lat, origin.lng, point.lat, point.lng) : null;
      return { shelter, point, km };
    });
    return rows.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  }, [shelters.data, origin]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGpsFailed(true);
      return;
    }
    setLocating(true);
    setGpsFailed(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setGpsFailed(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  if (!location) {
    return (
      <div className={cn(card, 'grid justify-items-start gap-3')}>
        <p className="text-muted-foreground">Pilih wilayah Anda untuk melihat posko pengungsian dan titik kumpul terdekat.</p>
        <button
          type="button"
          onClick={() => openPicker()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-extrabold text-primary-foreground"
        >
          <MapPin className="h-4 w-4" /> Pilih wilayah
        </button>
      </div>
    );
  }
  if (shelters.isLoading) return <Skeleton className="h-32 rounded-3xl" />;
  if (sorted.length === 0) {
    return (
      <p className={cn(card, 'text-muted-foreground')}>
        Belum ada posko atau titik kumpul terdaftar untuk {locationSummary(location)}. Saat keadaan darurat, ikuti arahan petugas atau papan jalur
        evakuasi.
      </p>
    );
  }
  const nearestId = sorted[0]?.km !== null ? sorted[0]?.shelter.id : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {gps
            ? 'Diurutkan dari yang terdekat dengan posisi Anda sekarang.'
            : `Diurutkan dari yang terdekat dengan pusat ${locationSummary(location)}.`}
          {gpsFailed && ' Lokasi HP tidak bisa dibaca; izinkan akses lokasi lalu coba lagi.'}
        </span>
        {!gps && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-extrabold text-primary hover:bg-accent"
          >
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Pakai lokasi saya
          </button>
        )}
      </div>
    <ul className="grid gap-3 md:grid-cols-2">
      {sorted.map(({ shelter, point, km }) => {
        const nearest = shelter.id === nearestId;
        const occupied = shelter.currentOccupancy ?? 0;
        const remaining = Math.max(0, shelter.capacity - occupied);
        return (
          <li
            key={shelter.id}
            className={cn(card, 'citizen-lift flex items-start gap-3 p-4', nearest && 'ring-2 ring-lv-normal/60 md:col-span-2')}
          >
            <span
              className={cn(
                'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
                shelter.kind === 'assembly_point' ? 'bg-primary/10 text-primary' : 'bg-lv-normal-soft text-lv-normal',
              )}
            >
              {shelter.kind === 'assembly_point' ? <Flag className="h-5 w-5" /> : <Tent className="h-5 w-5" />}
            </span>
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="flex flex-wrap items-center gap-2 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                {nearest && <span className="rounded-full bg-lv-normal px-2 py-0.5 text-white">Terdekat</span>}
                {SHELTER_KIND_LABELS[shelter.kind]}
                {km !== null && <span className="normal-case">· ± {formatDistance(km)}</span>}
              </span>
              <span className="font-extrabold">{shelter.name}</span>
              {shelter.address && <span className="text-sm text-muted-foreground">{shelter.address}</span>}
              {shelter.capacity > 0 && (
                <span className="text-sm text-muted-foreground">
                  Kapasitas {shelter.capacity.toLocaleString('id-ID')} orang · sisa ± {remaining.toLocaleString('id-ID')}
                </span>
              )}
              {shelter.notes && <span className="text-sm text-muted-foreground">{shelter.notes}</span>}
              {shelter.capacity > 0 && (
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-lv-normal"
                    style={{ width: `${Math.min(100, (occupied / shelter.capacity) * 100)}%` }}
                  />
                </span>
              )}
              {shelter.contactPhone && (
                <a
                  href={`tel:${shelter.contactPhone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex items-center gap-1 text-sm font-extrabold text-primary"
                >
                  <Phone className="h-3.5 w-3.5" /> {shelter.contactName ? `${shelter.contactName} · ` : ''}
                  {shelter.contactPhone}
                </a>
              )}
              {point && (
                <a
                  href={googleMapsDirectionsUrl(point.lat, point.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex items-center gap-1 text-sm font-extrabold',
                    nearest
                      ? 'mt-1 justify-self-start rounded-xl bg-lv-normal px-3.5 py-2 text-white'
                      : 'text-primary',
                  )}
                >
                  Rute jalan kaki ke sini <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </span>
          </li>
        );
      })}
    </ul>
    </div>
  );
}

export default function EmergencyPage() {
  return (
    <PageContainer>
      <PageHeading title="Butuh bantuan?" description="Nomor darurat nasional, posko pengungsian dan titik kumpul di wilayah Anda." />

      <a
        href="tel:112"
        className="group relative isolate mb-6 flex items-center gap-5 overflow-hidden rounded-[32px] bg-lv-awas-soft p-5 shadow-[0_20px_50px_-30px_var(--lv-awas)] ring-1 ring-lv-awas/15 transition-transform hover:-translate-y-0.5 sm:gap-7 sm:p-8"
      >
        <span aria-hidden className="citizen-dots absolute inset-y-0 right-0 -z-10 w-1/2 text-lv-awas opacity-50 [mask-image:linear-gradient(to_left,black,transparent)]" />
        <span className="citizen-sos relative isolate grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-lv-awas to-alarm text-3xl font-black text-white shadow-[0_10px_30px_-8px_var(--lv-awas)] sm:h-24 sm:w-24 sm:text-4xl">
          112
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-black tracking-tight sm:text-2xl">Panggilan darurat</span>
          <span className="text-muted-foreground">Gratis, aktif 24 jam, untuk semua keadaan darurat. Ketuk untuk menelepon.</span>
        </span>
        <span className="hidden items-center gap-2 rounded-2xl bg-lv-awas px-5 py-3 font-black text-white shadow-lg transition-transform group-hover:scale-105 sm:inline-flex dark:text-background">
          <Phone className="h-5 w-5" /> Telepon
        </span>
      </a>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <section>
          <SectionTitle>Nomor penting</SectionTitle>
          <EmergencyNumbers />
        </section>
        <section id="posko" className="scroll-mt-24">
          <SectionTitle>Posko & titik kumpul</SectionTitle>
          <Shelters />
        </section>
      </div>
    </PageContainer>
  );
}

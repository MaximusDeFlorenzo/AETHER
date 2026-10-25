'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import {
  ArrowUp,
  CircleCheck,
  ExternalLink,
  LifeBuoy,
  MapPin,
  Loader2,
  Navigation,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useRespondToAlert } from '@/hooks/use-public-alerts';
import { bearingDeg, compassName, distanceKm, formatDistance, googleMapsDirectionsUrl } from '@/lib/citizen/geo';
import { guideKeyForAlertHazard, GUIDES } from '@/lib/citizen/guides';
import { ALERT_LEVEL_TONE, alertLevelOf } from '@/lib/citizen/alert-level';
import { startSiren, stopSiren } from '@/lib/citizen/siren';
import type { PublicAlert } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { useCitizenStore } from '@/stores/citizen-store';
import { HazardIcon } from './hazard-icon';

type Step = 'alert' | 'route' | 'safe' | 'help';

interface Position {
  latitude: number;
  longitude: number;
}

function getPosition(timeoutMs = 8_000): Promise<Position | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

// While "Butuh bantuan" is open the location keeps going to the officers, but
// only as often as is useful: every minute, or sooner after moving 50 m.
const HELP_LOCATION_EVERY_MS = 60_000;
const HELP_LOCATION_MOVE_M = 50;

function areaLabel(alert: PublicAlert) {
  return alert.area.villageName ?? (alert.area.subdistrictName ? `Kec. ${alert.area.subdistrictName}` : alert.area.districtName);
}

/**
 * The "layar merah": one life-saving action, where to go, and three
 * buttons. Deliberately a fixed high-contrast look in both themes (white
 * on alarm red) — this is the one screen that must never be subtle.
 * `variant="overlay"` covers whatever page is open (AlarmWatcher);
 * `variant="page"` is the landing screen a push notification opens.
 */
export function AlarmOverlay({
  alert,
  variant,
  onDismiss,
  startWithHelp = false,
}: {
  alert: PublicAlert;
  variant: 'overlay' | 'page';
  onDismiss?: () => void;
  /** Opened from the "Butuh bantuan" shortcut: send the help request (with
   * location) straight away instead of showing the alarm first. */
  startWithHelp?: boolean;
}) {
  const [step, setStep] = useState<Step>('alert');
  const [sirenOn, setSirenOn] = useState(false);
  const [sirenBlocked, setSirenBlocked] = useState(false);
  const [heading, setHeading] = useState<{ bearing: number; km: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const deviceId = useCitizenStore((state) => state.deviceId);
  const markAlertHandled = useCitizenStore((state) => state.markAlertHandled);
  const respond = useRespondToAlert();
  // Separate mutation for live location updates, so they don't flip the help
  // screen back to "Mengirim…" every minute.
  const locationUpdate = useRespondToAlert();
  const [shareLocation, setShareLocation] = useState(true);
  const [locationSharedAt, setLocationSharedAt] = useState<Date | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const lastShared = useRef<{ at: number; position: Position } | null>(null);
  const detailsUpdate = useRespondToAlert();
  const [details, setDetails] = useState({ peopleCount: '', note: '', contactPhone: '' });
  const primaryRef = useRef<HTMLButtonElement>(null);

  const guideKey = guideKeyForAlertHazard(alert.hazard);
  const level = alertLevelOf(alert);
  const tone = ALERT_LEVEL_TONE[level];
  const hasDestination = alert.destinationLatitude !== null && alert.destinationLongitude !== null;

  const trySiren = useCallback(async () => {
    const ok = await startSiren(level);
    setSirenOn(ok);
    setSirenBlocked(!ok);
  }, [level]);

  const silence = useCallback(() => {
    stopSiren();
    setSirenOn(false);
  }, []);

  useEffect(() => {
    if (alert.isActive) void trySiren();
    return () => stopSiren();
  }, [alert.id, alert.isActive, trySiren]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (variant !== 'overlay') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [variant]);

  const goTo = (next: Step) => {
    if (next !== 'alert') silence();
    setStep(next);
  };

  const showDirection = async () => {
    if (!hasDestination) return;
    setLocating(true);
    setLocateFailed(false);
    const position = await getPosition();
    setLocating(false);
    if (!position) {
      setLocateFailed(true);
      return;
    }
    setHeading({
      bearing: bearingDeg(position.latitude, position.longitude, alert.destinationLatitude!, alert.destinationLongitude!),
      km: distanceKm(position.latitude, position.longitude, alert.destinationLatitude!, alert.destinationLongitude!),
    });
  };

  // Live location while asking for help: someone who moves (rising water,
  // walking to higher ground) stays findable. Stops on "Saya sudah aman",
  // when the screen closes, or when the citizen turns it off.
  useEffect(() => {
    if (step !== 'help' || !alert.isActive || !shareLocation) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLocationDenied(false);
        const position = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        const last = lastShared.current;
        const movedM = last
          ? distanceKm(last.position.latitude, last.position.longitude, position.latitude, position.longitude) * 1000
          : Infinity;
        if (last && Date.now() - last.at < HELP_LOCATION_EVERY_MS && movedM < HELP_LOCATION_MOVE_M) return;
        lastShared.current = { at: Date.now(), position };
        locationUpdate.mutate(
          { alertId: alert.id, deviceId, status: 'needs_help', ...position },
          { onSuccess: () => setLocationSharedAt(new Date()) },
        );
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setLocationDenied(true);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mutation object changes every render
  }, [step, alert.id, alert.isActive, shareLocation, deviceId]);

  const answer = async (status: 'safe' | 'needs_help') => {
    goTo(status === 'safe' ? 'safe' : 'help');
    markAlertHandled(alert.id);
    // Location only for "needs help", and only if the browser allows it —
    // the request still goes through without it.
    const position = status === 'needs_help' ? await getPosition() : null;
    if (position) {
      lastShared.current = { at: Date.now(), position };
      setLocationSharedAt(new Date());
    }
    respond.mutate({
      alertId: alert.id,
      deviceId,
      status,
      latitude: position?.latitude,
      longitude: position?.longitude,
    });
  };

  const helpStarted = useRef(false);
  useEffect(() => {
    if (!startWithHelp || helpStarted.current || !alert.isActive) return;
    helpStarted.current = true;
    void answer('needs_help');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on open
  }, [startWithHelp, alert.isActive]);

  const sendDetails = (event: React.FormEvent) => {
    event.preventDefault();
    const people = Number(details.peopleCount);
    detailsUpdate.mutate({
      alertId: alert.id,
      deviceId,
      status: 'needs_help',
      peopleCount: Number.isInteger(people) && people >= 1 ? Math.min(people, 999) : undefined,
      note: details.note.trim() || undefined,
      contactPhone: details.contactPhone.trim() || undefined,
    });
  };

  const close = () => {
    silence();
    markAlertHandled(alert.id);
    onDismiss?.();
  };

  const shell = cn(
    'font-citizen text-white',
    variant === 'overlay' ? 'fixed inset-0 z-[100] overflow-y-auto' : 'min-h-svh',
    step === 'safe' ? 'bg-lv-normal dark:bg-[#17663a]' : step === 'help' ? 'bg-[#1d3a6e]' : tone.bg,
    // Only Awas flashes; Siaga/Waspada stay a steady colour.
    step === 'alert' && alert.isActive && level === 'awas' && 'alarm-flash',
  );
  const whiteButton =
    'flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 text-lg font-black shadow-lg transition-transform active:scale-[0.99] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white';
  const ghostButton =
    'flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-white/80 bg-white/10 px-3 py-3.5 text-base font-black transition-colors hover:bg-white/20 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white';

  if (!alert.isActive) {
    return (
      <div className={cn('font-citizen flex min-h-svh items-center justify-center bg-background px-4 py-10')}>
        <div className="grid max-w-md gap-4 text-center">
          <CircleCheck className="mx-auto h-12 w-12 text-lv-normal" />
          <h1 className="text-2xl font-black">Peringatan ini sudah berakhir</h1>
          <p className="text-muted-foreground">
            {alert.title} untuk {areaLabel(alert)} sudah dicabut oleh petugas. Tetap ikuti kabar resmi dan kembali ke rumah hanya
            jika sudah dinyatakan aman.
          </p>
          <Link href="/" className="mx-auto rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground">
            Ke beranda
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-modal={variant === 'overlay'} aria-labelledby="alarm-action" className={shell}>
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-4 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 lg:max-w-2xl">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white sm:h-14 sm:w-14',
              step === 'safe' ? 'text-lv-normal' : step === 'help' ? 'text-[#1d3a6e]' : cn(level === 'awas' && 'alarm-ring', tone.text),
            )}
          >
            {step === 'safe' ? (
              <CircleCheck className="h-7 w-7" />
            ) : step === 'help' ? (
              <LifeBuoy className="h-7 w-7" />
            ) : (
              <HazardIcon alertHazard={alert.hazard} className="h-7 w-7" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black tracking-[0.12em] uppercase sm:text-sm">
              {step === 'safe' ? 'Tercatat aman' : step === 'help' ? 'Permintaan bantuan' : alert.title}
            </p>
            <p className="truncate text-xs font-bold opacity-90 sm:text-sm">
              {format(new Date(alert.createdAt), "HH.mm 'WIB' · d MMM", { locale: localeId })} · {areaLabel(alert)}
            </p>
          </div>
          {step === 'alert' && (
            <button
              type="button"
              onClick={sirenOn ? silence : trySiren}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/70 px-3 py-1.5 text-xs font-extrabold hover:bg-white/15"
            >
              {sirenOn ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {sirenOn ? 'Matikan suara' : 'Bunyikan sirine'}
            </button>
          )}
        </div>

        {step === 'alert' && (
          <>
            <h1 id="alarm-action" className="text-[2rem] leading-[1.05] font-black uppercase sm:text-5xl">
              {alert.action}
            </h1>
            <p className="text-base font-semibold sm:text-lg">{alert.message}</p>

            {(alert.destinationName || alert.avoidText) && (
              <div className="grid gap-3 rounded-2xl bg-white p-4 text-[#1b2640]">
                {alert.destinationName && (
                  <div className="flex items-center gap-3">
                    <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full', tone.soft, tone.text)}>
                      <Navigation className="h-6 w-6" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-[#4a5670] uppercase">Tujuan</p>
                      <p className="text-lg leading-tight font-black">{alert.destinationName}</p>
                    </div>
                  </div>
                )}
                {alert.avoidText && (
                  <p className="flex gap-2 rounded-xl bg-[#fff3c9] px-3 py-2 text-sm font-extrabold text-[#6b4400]">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {alert.avoidText}
                  </p>
                )}
              </div>
            )}

            {sirenBlocked && (
              <p className="rounded-xl bg-black/20 px-3 py-2 text-sm font-bold">
                Browser menahan suara sampai layar disentuh. Ketuk “Bunyikan sirine” di atas jika ingin suara alarm.
              </p>
            )}

            <div className="grid gap-2.5 sm:gap-3">
              <button
                ref={primaryRef}
                type="button"
                onClick={() => goTo('route')}
                className={cn(whiteButton, tone.text)}
              >
                <Navigation className="h-5 w-5" />
                {alert.destinationName ? 'Tunjukkan jalan' : 'Apa yang harus saya lakukan?'}
              </button>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <button type="button" onClick={() => answer('safe')} className={ghostButton}>
                  Saya sudah aman
                </button>
                <button type="button" onClick={() => answer('needs_help')} className={ghostButton}>
                  Butuh bantuan
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'route' && (
          <>
            <h1 id="alarm-action" className="text-3xl leading-tight font-black sm:text-4xl">
              {alert.destinationName ? `Ke ${alert.destinationName}` : alert.action}
            </h1>
            <div className="grid gap-3 rounded-2xl bg-white p-4 text-[#1b2640]">
              {hasDestination ? (
                <>
                  {heading ? (
                    <div className="flex items-center gap-4">
                      <span className={cn('grid h-16 w-16 shrink-0 place-items-center rounded-full', tone.soft, tone.text)}>
                        <ArrowUp className="h-9 w-9" style={{ transform: `rotate(${heading.bearing}deg)` }} />
                      </span>
                      <div>
                        <p className="text-2xl font-black">± {formatDistance(heading.km)}</p>
                        <p className="font-bold text-[#4a5670]">ke arah {compassName(heading.bearing)} dari posisi Anda</p>
                        <p className="text-xs text-[#4a5670]">Panah menunjuk arah mata angin (atas = utara).</p>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={showDirection}
                      disabled={locating}
                      className={cn('flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-black', tone.soft, tone.text)}
                    >
                      {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
                      Tunjukkan arah dari posisi saya
                    </button>
                  )}
                  {locateFailed && (
                    <p className="text-sm font-bold text-[#8a1c1c]">
                      Lokasi Anda tidak bisa dibaca. Gunakan tombol peta di bawah atau ikuti papan jalur evakuasi.
                    </p>
                  )}
                  <a
                    href={googleMapsDirectionsUrl(alert.destinationLatitude!, alert.destinationLongitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#1b2640]/15 px-3 py-3 font-black"
                  >
                    Buka rute jalan kaki di Google Maps <ExternalLink className="h-4 w-4" />
                  </a>
                </>
              ) : (
                <p className="font-bold">
                  {alert.destinationName
                    ? `Menuju ${alert.destinationName}. Ikuti papan jalur evakuasi dan arahan petugas.`
                    : 'Ikuti papan jalur evakuasi dan arahan petugas di lapangan.'}
                </p>
              )}
              {alert.avoidText && (
                <p className="flex gap-2 rounded-xl bg-[#fff3c9] px-3 py-2 text-sm font-extrabold text-[#6b4400]">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {alert.avoidText}
                </p>
              )}
              {guideKey && (
                <div>
                  <p className="mb-1.5 text-xs font-extrabold text-[#4a5670] uppercase">Sambil bergerak</p>
                  <ul className="grid gap-1.5 text-sm font-bold">
                    {GUIDES[guideKey].during.slice(0, 3).map((tip) => (
                      <li key={tip} className="flex gap-2">
                        <span aria-hidden>•</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button ref={primaryRef} type="button" onClick={() => answer('safe')} className={cn(whiteButton, tone.text)}>
              Saya sudah sampai dan aman
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => goTo('alert')} className={ghostButton}>
                Kembali
              </button>
              <button type="button" onClick={() => answer('needs_help')} className={ghostButton}>
                Butuh bantuan
              </button>
            </div>
          </>
        )}

        {step === 'safe' && (
          <>
            <h1 id="alarm-action" className="text-4xl leading-tight font-black">
              Anda tercatat aman
            </h1>
            <p className="text-lg font-semibold">Petugas BPBD bisa melihat bahwa Anda sudah aman. Terima kasih sudah bergerak cepat.</p>
            <ul className="grid gap-2 text-base font-bold">
              <li>• Tetap di tempat aman sampai peringatan dicabut.</li>
              <li>• Jika bisa, bantu tetangga lansia atau penyandang disabilitas tanpa membahayakan diri.</li>
              <li>• Ikuti kabar resmi, jangan percaya pesan berantai.</li>
            </ul>
            {respond.isError && (
              <p className="rounded-xl bg-black/20 px-3 py-2 text-sm font-bold">
                Jawaban belum terkirim karena sinyal. Coba lagi saat sinyal ada.
              </p>
            )}
            <button ref={primaryRef} type="button" onClick={close} className={cn(whiteButton, 'text-lv-normal')}>
              {variant === 'page' ? 'Ke beranda' : 'Tutup'}
            </button>
          </>
        )}

        {step === 'help' && (
          <>
            <h1 id="alarm-action" className="text-4xl leading-tight font-black">
              {respond.isPending ? 'Mengirim permintaan bantuan…' : respond.isError ? 'Belum terkirim' : 'Bantuan sedang diteruskan'}
            </h1>
            <p className="text-lg font-semibold">
              {respond.isError
                ? 'Sinyal bermasalah. Telepon 112 sekarang jika bisa.'
                : 'Petugas BPBD menerima permintaan Anda, beserta lokasi jika Anda mengizinkannya. Tetap di tempat paling tinggi dan aman yang bisa Anda capai.'}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/15 px-4 py-3 text-sm font-bold">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                {!shareLocation
                  ? 'Lokasi tidak lagi dibagikan.'
                  : locationDenied
                    ? 'Lokasi belum bisa dibaca. Izinkan akses lokasi di pengaturan browser.'
                    : locationSharedAt
                      ? `Lokasi Anda dibagikan langsung ke petugas · diperbarui ${locationSharedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Mencari lokasi Anda…'}
              </span>
              <button type="button" onClick={() => setShareLocation((on) => !on)} className="underline underline-offset-2">
                {shareLocation ? 'Berhenti bagikan' : 'Bagikan lagi'}
              </button>
            </div>
            <form onSubmit={sendDetails} className="grid gap-2 rounded-2xl bg-white/15 p-4 text-sm">
              <p className="font-black">Tambah info untuk petugas (opsional)</p>
              <textarea
                value={details.note}
                maxLength={300}
                onChange={(event) => setDetails((current) => ({ ...current, note: event.target.value }))}
                placeholder="Alasan / kondisi, mis. ada lansia, terjebak di lantai 2, kaki terluka"
                className="min-h-20 rounded-xl bg-white px-3 py-2 font-semibold text-[#1b2640] placeholder:text-[#1b2640]/50"
              />
              <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  value={details.peopleCount}
                  onChange={(event) => setDetails((current) => ({ ...current, peopleCount: event.target.value }))}
                  placeholder="Jumlah orang"
                  aria-label="Jumlah orang"
                  className="rounded-xl bg-white px-3 py-2 font-semibold text-[#1b2640] placeholder:text-[#1b2640]/50"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  maxLength={30}
                  value={details.contactPhone}
                  onChange={(event) => setDetails((current) => ({ ...current, contactPhone: event.target.value }))}
                  placeholder="No. HP yang bisa dihubungi"
                  aria-label="Nomor HP"
                  className="rounded-xl bg-white px-3 py-2 font-semibold text-[#1b2640] placeholder:text-[#1b2640]/50"
                />
              </div>
              <button type="submit" disabled={detailsUpdate.isPending} className={cn(ghostButton, 'py-2.5')}>
                {detailsUpdate.isPending
                  ? 'Mengirim…'
                  : detailsUpdate.isSuccess
                    ? 'Info terkirim · kirim ulang jika berubah'
                    : detailsUpdate.isError
                      ? 'Gagal terkirim, coba lagi'
                      : 'Kirim info ke petugas'}
              </button>
            </form>
            <ul className="grid gap-2 text-base font-bold">
              <li>• Telepon 112 jika sinyal ada. Layanan ini gratis.</li>
              <li>• Nyalakan senter HP atau lambaikan kain terang supaya mudah terlihat.</li>
              <li>• Hemat baterai: tutup aplikasi lain dan redupkan layar.</li>
            </ul>
            <div className="grid gap-2.5">
              <a href="tel:112" className={cn(whiteButton, 'text-[#1d3a6e]')}>
                Telepon 112
              </a>
              {respond.isError && (
                <button type="button" onClick={() => answer('needs_help')} className={ghostButton}>
                  Kirim ulang permintaan bantuan
                </button>
              )}
              <button ref={primaryRef} type="button" onClick={() => answer('safe')} className={ghostButton}>
                Saya sudah aman sekarang
              </button>
            </div>
          </>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-2 text-xs font-bold opacity-90 sm:text-sm">
          <span>Sumber: {alert.sourceLabel}</span>
          {(step === 'alert' || step === 'route') && (
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center gap-1 rounded-full border border-white/60 px-3 py-1.5 hover:bg-white/15"
            >
              <X className="h-3.5 w-3.5" /> Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

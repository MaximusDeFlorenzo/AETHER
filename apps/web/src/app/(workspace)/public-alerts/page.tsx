'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Navigation, Siren, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HazardIcon } from '@/components/citizen/hazard-icon';
import { useDistrict, useDistricts, useProvinces, useSubdistricts, useVillages } from '@/hooks/use-geo';
import {
  useAlertResponses,
  useCreatePublicAlert,
  useEndPublicAlert,
  useOperatorAlerts,
  type CreatePublicAlertInput,
} from '@/hooks/use-public-alerts';
import { useShelters } from '@/hooks/use-resource-plans';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { googleMapsDirectionsUrl } from '@/lib/citizen/geo';
import { shelterLatLng, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import { ALERT_HAZARD_LABEL, HAZARD_LABEL_ID, isRecent } from '@/lib/citizen/status';
import { ALERT_LEVEL_TONE, ALERT_LEVELS, alertLevelOf } from '@/lib/citizen/alert-level';
import type { OperatorPublicAlert, PublicAlertHazard, PublicAlertLevel } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { HazardType } from '@/types/domain';
import { PageHeader } from '@/components/shared/page-header';


// react-leaflet touches `window` at import time — client-only.
const HelpRequestsMap = dynamic(
  () => import('@/components/public-alerts/help-requests-map').then((mod) => mod.HelpRequestsMap),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted" /> },
);
const HAZARDS: PublicAlertHazard[] = ['flood', 'tsunami', 'volcano', 'landslide', 'earthquake', 'wildfire_smoke', 'other'];

// Starting text per hazard — the operator edits it; these only exist so the
// most time-critical alarms (tsunami) can go out in seconds.
const DEFAULTS: Record<PublicAlertHazard, { title: string; action: string; message: string; avoid: string }> = {
  flood: {
    title: 'Awas banjir',
    action: 'Pergi ke posko sekarang',
    message: 'Air naik cepat dan bisa membahayakan nyawa. Segera tinggalkan rumah menuju tempat aman.',
    avoid: 'Jangan menyeberangi arus dan jauhi tepi sungai.',
  },
  tsunami: {
    title: 'Peringatan dini tsunami',
    action: 'Lari ke tempat tinggi sekarang',
    message: 'Gempa kuat di laut berpotensi tsunami. Gelombang bisa tiba dalam hitungan menit.',
    avoid: 'Jauhi pantai dan sungai. Jangan kembali untuk mengambil barang.',
  },
  volcano: {
    title: 'Gunung api level IV · Awas',
    action: 'Keluar dari radius bahaya sekarang',
    message: 'Gunung api erupsi. Seluruh warga di dalam radius bahaya wajib mengungsi.',
    avoid: 'Jauhi sungai yang berhulu di gunung (bahaya lahar).',
  },
  landslide: {
    title: 'Awas longsor',
    action: 'Segera menjauh dari lereng',
    message: 'Tanah bergerak di sekitar wilayah Anda. Tinggalkan rumah di dekat lereng sekarang.',
    avoid: 'Jangan melewati jalan di bawah tebing.',
  },
  earthquake: {
    title: 'Gempa kuat',
    action: 'Keluar ke tempat terbuka dengan tenang',
    message: 'Gempa kuat baru terjadi. Waspadai gempa susulan dan bangunan yang retak.',
    avoid: 'Jauhi bangunan retak, tiang listrik, dan tebing.',
  },
  wildfire_smoke: {
    title: 'Udara berbahaya',
    action: 'Masuk rumah dan tutup semua jendela',
    message: 'Asap kebakaran lahan sangat pekat dan berbahaya bagi pernapasan.',
    avoid: 'Jangan keluar rumah tanpa masker N95.',
  },
  other: { title: 'Keadaan darurat', action: '', message: '', avoid: '' },
};

const HAZARD_TYPE_TO_ALERT: Record<HazardType, PublicAlertHazard> = {
  flood: 'flood',
  earthquake: 'earthquake',
  landslide: 'landslide',
  wildfire: 'wildfire_smoke',
};

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50';
const textareaClass =
  'min-h-20 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

interface FormState {
  hazard: PublicAlertHazard;
  level: PublicAlertLevel;
  title: string;
  action: string;
  message: string;
  avoidText: string;
  sourceLabel: string;
  provinceId: string;
  districtId: string;
  subdistrictId: string;
  villageId: string;
  shelterId: string;
  destinationName: string;
  destinationLatitude: string;
  destinationLongitude: string;
  expiresInHours: string;
  hazardEventId: string;
}

const EMPTY_FORM: FormState = {
  hazard: 'flood',
  level: 'awas',
  ...{
    title: DEFAULTS.flood.title,
    action: DEFAULTS.flood.action,
    message: DEFAULTS.flood.message,
    avoidText: DEFAULTS.flood.avoid,
  },
  sourceLabel: '',
  provinceId: '',
  districtId: '',
  subdistrictId: '',
  villageId: '',
  shelterId: '',
  destinationName: '',
  destinationLatitude: '',
  destinationLongitude: '',
  expiresInHours: '12',
  hazardEventId: '',
};

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AlarmPreview({ form, areaName }: { form: FormState; areaName: string }) {
  const tone = ALERT_LEVEL_TONE[form.level];
  return (
    <div className={cn('grid gap-3 rounded-2xl p-4 font-citizen text-white shadow-lg', tone.bg)}>
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-10 w-10 place-items-center rounded-full bg-white', tone.text)}>
          <HazardIcon alertHazard={form.hazard} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-black tracking-widest uppercase">{form.title || 'Judul level'}</p>
          <p className="truncate text-xs font-bold opacity-90">{areaName || 'Wilayah belum dipilih'}</p>
        </div>
      </div>
      <p className="text-2xl leading-tight font-black uppercase">{form.action || 'Tindakan penyelamatan'}</p>
      <p className="text-sm font-semibold">{form.message || 'Pesan singkat untuk warga.'}</p>
      {(form.destinationName || form.avoidText) && (
        <div className="grid gap-2 rounded-xl bg-white p-3 text-[#1b2640]">
          {form.destinationName && (
            <p className="flex items-center gap-2 font-black">
              <Navigation className={cn('h-4 w-4', tone.text)} /> {form.destinationName}
            </p>
          )}
          {form.avoidText && (
            <p className="rounded-lg bg-[#fff3c9] px-2 py-1.5 text-xs font-extrabold text-[#6b4400]">{form.avoidText}</p>
          )}
        </div>
      )}
      <div className="grid gap-2">
        <span className="rounded-xl bg-white py-2.5 text-center text-sm font-black text-alarm">Tunjukkan jalan</span>
        <div className="grid grid-cols-2 gap-2 text-center text-xs font-black">
          <span className="rounded-xl border-2 border-white/80 py-2">Saya sudah aman</span>
          <span className="rounded-xl border-2 border-white/80 py-2">Butuh bantuan</span>
        </div>
      </div>
      <p className="text-[11px] font-bold opacity-90">Sumber: {form.sourceLabel || '—'}</p>
    </div>
  );
}

function HelpRequests({ alert }: { alert: OperatorPublicAlert }) {
  const { data, isLoading } = useAlertResponses(alert.id);
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!data || data.needsHelp.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada permintaan bantuan.</p>;
  }
  const destination =
    alert.destinationLatitude !== null && alert.destinationLongitude !== null
      ? { name: alert.destinationName ?? 'Tujuan evakuasi', lat: alert.destinationLatitude, lng: alert.destinationLongitude }
      : null;
  const anyLocated = data.needsHelp.some((request) => request.latitude !== null && request.longitude !== null);
  return (
    <div className="grid gap-3">
      {anyLocated && (
        <div className="h-72 overflow-hidden rounded-xl border border-border">
          <HelpRequestsMap requests={data.needsHelp} destination={destination} />
        </div>
      )}
      <ol className="grid gap-1.5 text-sm">
        {data.needsHelp.map((request, index) => (
          <li key={request.id} className="grid gap-1 rounded-lg bg-muted px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                #{index + 1}
                {request.peopleCount !== null && ` · ${request.peopleCount} orang`}
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · minta bantuan {formatDistanceToNowStrict(new Date(request.createdAt), { addSuffix: true, locale: localeId })}
                </span>
              </span>
              {request.latitude !== null && request.longitude !== null ? (
                <a
                  href={googleMapsDirectionsUrl(request.latitude, request.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary"
                >
                  Rute · lokasi {formatDistanceToNowStrict(new Date(request.updatedAt), { addSuffix: true, locale: localeId })}{' '}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-muted-foreground">Lokasi tidak dibagikan</span>
              )}
            </div>
            {request.note && <p>{request.note}</p>}
            {request.contactPhone && (
              <a href={`tel:${request.contactPhone.replace(/[^\d+]/g, '')}`} className="font-medium text-primary">
                {request.contactPhone}
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AlertRow({ alert, canIssue }: { alert: OperatorPublicAlert; canIssue: boolean }) {
  const endAlert = useEndPublicAlert();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const expired = alert.status === 'active' && !alert.isActive;
  const area = [alert.area.villageName, alert.area.subdistrictName && `Kec. ${alert.area.subdistrictName}`, alert.area.districtName]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="grid gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                alert.isActive ? 'bg-danger text-white' : 'bg-muted text-muted-foreground',
              )}
            >
              {alert.isActive ? 'Aktif' : expired ? 'Kedaluwarsa' : 'Berakhir'}
            </Badge>
            <Badge className={cn('text-white', ALERT_LEVEL_TONE[alertLevelOf(alert)].bg)}>
              {ALERT_LEVEL_TONE[alertLevelOf(alert)].label}
            </Badge>
            <span className="text-sm font-semibold">{alert.title}</span>
            <span className="text-xs text-muted-foreground">· {ALERT_HAZARD_LABEL[alert.hazard]}</span>
          </div>
          <p className="font-medium">{alert.action}</p>
          <p className="text-xs text-muted-foreground">
            {area} · {format(new Date(alert.createdAt), 'd MMM yyyy HH.mm', { locale: localeId })}
            {alert.createdByName ? ` · oleh ${alert.createdByName}` : ''}
            {alert.isActive ? ` · berakhir otomatis ${format(new Date(alert.expiresAt), 'd MMM HH.mm', { locale: localeId })}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-muted px-2 py-1">
            Push: <strong>{alert.pushSentCount}</strong> terkirim
            {alert.pushFailedCount > 0 ? `, ${alert.pushFailedCount} gagal` : ''}
          </span>
          <span className="rounded-md bg-lv-normal-soft px-2 py-1 text-lv-normal">
            Aman: <strong>{alert.responses.safe}</strong>
          </span>
          <button
            type="button"
            onClick={() => setShowHelp((open) => !open)}
            className="rounded-md bg-lv-awas-soft px-2 py-1 text-lv-awas"
          >
            Butuh bantuan: <strong>{alert.responses.needsHelp}</strong>
          </button>
        </div>
      </div>
      {showHelp && <HelpRequests alert={alert} />}
      {alert.isActive && canIssue && (
        <div className="flex flex-wrap items-center gap-2">
          {confirmEnd ? (
            <>
              <span className="text-sm">Akhiri alarm ini untuk semua warga?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={endAlert.isPending}
                onClick={() =>
                  endAlert.mutate(alert.id, {
                    onSuccess: () => toast.success('Alarm diakhiri'),
                    onError: () => toast.error('Gagal mengakhiri alarm'),
                  })
                }
              >
                Ya, akhiri
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
                Batal
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmEnd(true)}>
              Akhiri alarm
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function PublicAlertsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canIssue = role === 'admin' || role === 'agency_operator';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [verified, setVerified] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const provinces = useProvinces();
  const districts = useDistricts(form.provinceId || undefined);
  const subdistricts = useSubdistricts({ districtId: form.districtId || undefined, limit: 200 });
  const villages = useVillages({ subdistrictId: form.subdistrictId || undefined, limit: 200 });
  const shelters = useShelters(form.districtId || undefined);
  const selectedDistrict = useDistrict(form.districtId || undefined);
  const createAlert = useCreatePublicAlert();
  const alerts = useOperatorAlerts();
  const assessments = useRiskAssessments({ limit: 100, baseline: false });

  // A suggestion can set the district before the province is known.
  useEffect(() => {
    const provinceId = selectedDistrict.data?.province?.id;
    if (provinceId && !form.provinceId) setForm((current) => ({ ...current, provinceId }));
  }, [selectedDistrict.data, form.provinceId]);

  const districtName = selectedDistrict.data?.name ?? '';
  const subdistrictName = subdistricts.data?.data.find((s) => s.id === form.subdistrictId)?.name;
  const villageName = villages.data?.data.find((v) => v.id === form.villageId)?.name;
  const areaName = [villageName, subdistrictName && `Kec. ${subdistrictName}`, districtName].filter(Boolean).join(', ');

  const suggestions = useMemo(
    () =>
      (assessments.data?.data ?? [])
        .filter(
          (assessment) =>
            assessment.status === 'completed' &&
            (assessment.exposureLevel === 'severe' || assessment.exposureLevel === 'high') &&
            assessment.hazardEvent &&
            isRecent(assessment.hazardEvent.eventTime),
        )
        .slice(0, 6),
    [assessments.data],
  );

  const chooseHazard = (hazard: PublicAlertHazard) => {
    const previous = DEFAULTS[form.hazard];
    const next = DEFAULTS[hazard];
    // Only swap in new starter text where the operator hasn't typed their own.
    setForm((current) => ({
      ...current,
      hazard,
      title: current.title === previous.title ? next.title : current.title,
      action: current.action === previous.action ? next.action : current.action,
      message: current.message === previous.message ? next.message : current.message,
      avoidText: current.avoidText === previous.avoid ? next.avoid : current.avoidText,
    }));
  };

  const chooseShelter = (shelterId: string) => {
    const shelter = shelters.data?.find((s) => s.id === shelterId);
    const point = shelter ? shelterLatLng(shelter) : null;
    setForm((current) => ({
      ...current,
      shelterId,
      destinationName: shelter ? `${SHELTER_KIND_LABELS[shelter.kind]} ${shelter.name}` : current.destinationName,
      destinationLatitude: point ? String(point.lat) : current.destinationLatitude,
      destinationLongitude: point ? String(point.lng) : current.destinationLongitude,
    }));
  };

  const hasLat = form.destinationLatitude.trim() !== '';
  const hasLng = form.destinationLongitude.trim() !== '';
  const coordsInvalid = hasLat !== hasLng;
  const canSubmit =
    canIssue &&
    verified &&
    !!form.districtId &&
    form.title.trim() &&
    form.action.trim() &&
    form.message.trim() &&
    !coordsInvalid &&
    !createAlert.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const input: CreatePublicAlertInput = {
      hazard: form.hazard,
      level: form.level,
      title: form.title.trim(),
      action: form.action.trim(),
      message: form.message.trim(),
      avoidText: form.avoidText.trim() || undefined,
      sourceLabel: form.sourceLabel.trim() || `BPBD ${districtName}`.trim(),
      districtId: form.districtId,
      subdistrictId: form.subdistrictId || undefined,
      villageId: form.villageId || undefined,
      destinationName: form.destinationName.trim() || undefined,
      destinationLatitude: hasLat ? Number(form.destinationLatitude) : undefined,
      destinationLongitude: hasLng ? Number(form.destinationLongitude) : undefined,
      hazardEventId: form.hazardEventId || undefined,
      expiresInHours: Math.min(72, Math.max(1, Number(form.expiresInHours) || 12)),
    };
    createAlert.mutate(input, {
      onSuccess: () => {
        toast.success('Alarm terkirim ke warga');
        setVerified(false);
        setForm(EMPTY_FORM);
      },
      onError: () => toast.error('Alarm gagal dikirim. Periksa isian lalu coba lagi.'),
    });
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader icon={Siren} title="Peringatan Darurat Warga"
        description="Alarm layar merah untuk warga di satu wilayah: satu tindakan penyelamatan, tujuan, dan hal yang harus dihindari. Terkirim sebagai notifikasi ke HP warga yang mengaktifkan peringatan, dan langsung tampil di portal yang sedang terbuka. Gunakan hanya untuk ancaman terhadap nyawa. Alarm yang terlalu sering membuat warga berhenti percaya."
      />

      {!canIssue && (
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          Hanya admin dan operator lembaga yang bisa mengirim atau mengakhiri alarm. Anda bisa melihat riwayatnya di bawah.
        </p>
      )}

      {canIssue && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>Buat alarm</CardTitle>
              <CardDescription>Semua isian tampil apa adanya di HP warga. Tulis singkat dan jelas.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Jenis bahaya" htmlFor="alert-hazard">
                    <select
                      id="alert-hazard"
                      className={selectClass}
                      value={form.hazard}
                      onChange={(event) => chooseHazard(event.target.value as PublicAlertHazard)}
                    >
                      {HAZARDS.map((hazard) => (
                        <option key={hazard} value={hazard}>
                          {ALERT_HAZARD_LABEL[hazard]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Berlaku (jam)" htmlFor="alert-expiry" hint="Alarm berhenti otomatis setelah waktu ini (1–72 jam).">
                    <Input
                      id="alert-expiry"
                      type="number"
                      min={1}
                      max={72}
                      value={form.expiresInHours}
                      onChange={(event) => set('expiresInHours', event.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  label="Level peringatan"
                  htmlFor="alert-level-awas"
                  hint="Warna layar di HP warga. Awas: merah berkedip, sirine terus. Siaga: oranye, sirine 3×. Waspada: kuning tua, sirine 1×."
                >
                  <div role="radiogroup" aria-label="Level peringatan" className="grid grid-cols-3 gap-2">
                    {ALERT_LEVELS.map((level) => {
                      const tone = ALERT_LEVEL_TONE[level];
                      const on = form.level === level;
                      return (
                        <button
                          key={level}
                          id={`alert-level-${level}`}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => set('level', level)}
                          className={cn(
                            'rounded-lg border-2 px-3 py-2 text-sm font-black tracking-wide transition-colors',
                            on ? cn(tone.bg, 'border-transparent text-white') : cn('border-border bg-background', tone.text),
                          )}
                        >
                          {tone.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
                  <legend className="px-1 text-sm font-medium">Wilayah sasaran</legend>
                  <Field label="Provinsi" htmlFor="alert-province">
                    <select
                      id="alert-province"
                      className={selectClass}
                      value={form.provinceId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          provinceId: event.target.value,
                          districtId: '',
                          subdistrictId: '',
                          villageId: '',
                          shelterId: '',
                        }))
                      }
                    >
                      <option value="">Pilih provinsi</option>
                      {provinces.data?.map((province) => (
                        <option key={province.id} value={province.id}>
                          {province.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kabupaten/Kota (wajib)" htmlFor="alert-district">
                    <select
                      id="alert-district"
                      className={selectClass}
                      value={form.districtId}
                      disabled={!form.provinceId && !form.districtId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          districtId: event.target.value,
                          subdistrictId: '',
                          villageId: '',
                          shelterId: '',
                        }))
                      }
                    >
                      <option value="">Pilih kabupaten/kota</option>
                      {form.districtId && !districts.data?.some((d) => d.id === form.districtId) && districtName && (
                        <option value={form.districtId}>{districtName}</option>
                      )}
                      {districts.data?.map((district) => (
                        <option key={district.id} value={district.id}>
                          {district.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kecamatan (opsional)" htmlFor="alert-subdistrict" hint="Kosongkan untuk seluruh kabupaten/kota.">
                    <select
                      id="alert-subdistrict"
                      className={selectClass}
                      value={form.subdistrictId}
                      disabled={!form.districtId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, subdistrictId: event.target.value, villageId: '' }))
                      }
                    >
                      <option value="">Semua kecamatan</option>
                      {subdistricts.data?.data.map((subdistrict) => (
                        <option key={subdistrict.id} value={subdistrict.id}>
                          {subdistrict.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Desa/Kelurahan (opsional)" htmlFor="alert-village">
                    <select
                      id="alert-village"
                      className={selectClass}
                      value={form.villageId}
                      disabled={!form.subdistrictId}
                      onChange={(event) => set('villageId', event.target.value)}
                    >
                      <option value="">Semua desa</option>
                      {villages.data?.data.map((village) => (
                        <option key={village.id} value={village.id}>
                          {village.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-xs text-muted-foreground md:col-span-2">
                    Warga yang hanya memilih kabupaten/kota (tanpa kecamatan/desa) tetap menerima alarm untuk wilayah di
                    dalamnya, supaya tidak ada yang terlewat.
                  </p>
                </fieldset>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Judul level" htmlFor="alert-title" hint="Contoh: Awas banjir">
                    <Input id="alert-title" maxLength={120} value={form.title} onChange={(event) => set('title', event.target.value)} />
                  </Field>
                  <Field label="Satu tindakan penyelamatan" htmlFor="alert-action" hint="Kata kerja, contoh: Lari ke tempat tinggi sekarang">
                    <Input id="alert-action" maxLength={160} value={form.action} onChange={(event) => set('action', event.target.value)} />
                  </Field>
                </div>
                <Field label="Pesan singkat" htmlFor="alert-message">
                  <textarea
                    id="alert-message"
                    maxLength={2000}
                    className={textareaClass}
                    value={form.message}
                    onChange={(event) => set('message', event.target.value)}
                  />
                </Field>

                <fieldset className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
                  <legend className="px-1 text-sm font-medium">Tujuan (opsional)</legend>
                  <Field label="Pilih posko / titik kumpul terdaftar" htmlFor="alert-shelter">
                    <select
                      id="alert-shelter"
                      className={selectClass}
                      value={form.shelterId}
                      disabled={!form.districtId || !shelters.data?.length}
                      onChange={(event) => chooseShelter(event.target.value)}
                    >
                      <option value="">{shelters.data?.length ? 'Pilih lokasi' : 'Belum ada posko atau titik kumpul terdaftar'}</option>
                      {shelters.data?.map((shelter) => (
                        <option key={shelter.id} value={shelter.id}>
                          {SHELTER_KIND_LABELS[shelter.kind]}: {shelter.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Nama tujuan" htmlFor="alert-destination" hint="Contoh: Bukit Pasir Putih, atau Posko SDN 2">
                    <Input
                      id="alert-destination"
                      maxLength={200}
                      value={form.destinationName}
                      onChange={(event) => set('destinationName', event.target.value)}
                    />
                  </Field>
                  <Field label="Lintang (latitude)" htmlFor="alert-lat">
                    <Input
                      id="alert-lat"
                      inputMode="decimal"
                      placeholder="-6.9187"
                      value={form.destinationLatitude}
                      onChange={(event) => set('destinationLatitude', event.target.value)}
                    />
                  </Field>
                  <Field label="Bujur (longitude)" htmlFor="alert-lng" hint="Dengan koordinat, warga bisa membuka rute jalan kaki.">
                    <Input
                      id="alert-lng"
                      inputMode="decimal"
                      placeholder="106.9272"
                      value={form.destinationLongitude}
                      onChange={(event) => set('destinationLongitude', event.target.value)}
                    />
                  </Field>
                  {coordsInvalid && (
                    <p className="text-xs text-danger md:col-span-2">Isi lintang dan bujur sekaligus, atau kosongkan keduanya.</p>
                  )}
                </fieldset>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Yang harus dihindari" htmlFor="alert-avoid">
                    <Input id="alert-avoid" maxLength={300} value={form.avoidText} onChange={(event) => set('avoidText', event.target.value)} />
                  </Field>
                  <Field label="Sumber" htmlFor="alert-source" hint={`Kosongkan untuk “BPBD ${districtName || '…'}”.`}>
                    <Input
                      id="alert-source"
                      maxLength={160}
                      placeholder={`BPBD ${districtName}`}
                      value={form.sourceLabel}
                      onChange={(event) => set('sourceLabel', event.target.value)}
                    />
                  </Field>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
                  <input
                    id="alert-verified"
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--danger)]"
                    checked={verified}
                    onChange={(event) => setVerified(event.target.checked)}
                  />
                  <span>
                    Saya sudah memverifikasi ancaman ini dengan sumber resmi atau petugas di lapangan, dan alarm ini
                    diperlukan untuk menyelamatkan nyawa.
                  </span>
                </label>

                <Button type="submit" variant="destructive" size="lg" disabled={!canSubmit} className="h-11 text-base">
                  {createAlert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />}
                  Kirim alarm ke warga {areaName ? `di ${areaName}` : ''}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Pratinjau di HP warga</CardTitle>
              </CardHeader>
              <CardContent>
                <AlarmPreview form={form} areaName={areaName} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Usulan dari mesin risiko</CardTitle>
                <CardDescription>
                  Wilayah dengan paparan tinggi/sangat tinggi dari kejadian 24 jam terakhir. Usulan saja, keputusan tetap di
                  tangan petugas.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {assessments.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {!assessments.isLoading && suggestions.length === 0 && (
                  <p className="text-sm text-muted-foreground">Tidak ada wilayah berisiko tinggi saat ini.</p>
                )}
                {suggestions.map((assessment) => (
                  <div key={assessment.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <TriangleAlert
                          className={cn('h-4 w-4 shrink-0', assessment.exposureLevel === 'severe' ? 'text-danger' : 'text-warning')}
                        />
                        {assessment.district.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {HAZARD_LABEL_ID[assessment.hazardType]} · paparan {assessment.exposureLevel === 'severe' ? 'sangat tinggi' : 'tinggi'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        chooseHazard(HAZARD_TYPE_TO_ALERT[assessment.hazardType]);
                        setForm((current) => ({
                          ...current,
                          provinceId: '',
                          districtId: assessment.district.id,
                          subdistrictId: '',
                          villageId: '',
                          shelterId: '',
                          hazardEventId: assessment.hazardEvent?.id ?? '',
                        }));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Siapkan alarm
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Riwayat alarm</CardTitle>
          <CardDescription>Jawaban warga diperbarui otomatis setiap 15 detik.</CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : alerts.isError ? (
            <p className="text-sm text-danger">Riwayat alarm gagal dimuat.</p>
          ) : !alerts.data?.data.length ? (
            <p className="text-sm text-muted-foreground">Belum ada alarm yang pernah dikirim.</p>
          ) : (
            <ul className="grid gap-3">
              {alerts.data.data.map((alert) => (
                <AlertRow key={alert.id} alert={alert} canIssue={canIssue} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

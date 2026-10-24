'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Flag, MapPin, Pencil, Plus, Tent, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { useDistricts, useProvinces } from '@/hooks/use-geo';
import { useDeleteShelter, useManagedShelters, useSaveShelter } from '@/hooks/use-shelters';
import { shelterLatLng, SHELTER_KIND_COLORS, SHELTER_KIND_LABELS } from '@/lib/citizen/shelters';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { District, Shelter, ShelterInput, ShelterKind } from '@/types/domain';

const ShelterManagerMap = dynamic(() => import('@/components/shelters/shelter-manager-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50';
const textareaClass =
  'min-h-20 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const KIND_ICONS: Record<ShelterKind, typeof Tent> = { posko: Tent, assembly_point: Flag };
const KINDS: ShelterKind[] = ['posko', 'assembly_point'];

interface FormState {
  id?: string;
  kind: ShelterKind;
  name: string;
  districtId: string;
  /** False until the officer picks a district by hand — until then it
   * follows the nearest district centroid to the placed point. */
  districtTouched: boolean;
  latitude: string;
  longitude: string;
  capacity: string;
  currentOccupancy: string;
  address: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  isActive: boolean;
}

function emptyForm(districtId: string): FormState {
  return {
    kind: 'posko',
    name: '',
    districtId,
    districtTouched: districtId !== '',
    latitude: '',
    longitude: '',
    capacity: '',
    currentOccupancy: '0',
    address: '',
    contactName: '',
    contactPhone: '',
    notes: '',
    isActive: true,
  };
}

function formFromShelter(shelter: Shelter): FormState {
  const point = shelterLatLng(shelter);
  return {
    id: shelter.id,
    kind: shelter.kind,
    name: shelter.name,
    districtId: shelter.district.id,
    districtTouched: true,
    latitude: point ? point.lat.toFixed(6) : '',
    longitude: point ? point.lng.toFixed(6) : '',
    capacity: String(shelter.capacity),
    currentOccupancy: String(shelter.currentOccupancy ?? 0),
    address: shelter.address ?? '',
    contactName: shelter.contactName ?? '',
    contactPhone: shelter.contactPhone ?? '',
    notes: shelter.notes ?? '',
    isActive: shelter.isActive,
  };
}

/** Districts only carry a reference point (no boundary), so the "district of
 * this point" is the nearest centroid — a suggestion the officer confirms. */
function nearestDistrict(districts: District[], lat: number, lng: number): District | null {
  let best: District | null = null;
  let bestDist = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const district of districts) {
    const c = district.geom?.coordinates;
    if (!c) continue;
    const d = (c[1] - lat) ** 2 + ((c[0] - lng) * cosLat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = district;
    }
  }
  return best;
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function KindBadge({ kind }: { kind: ShelterKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
      style={{ background: SHELTER_KIND_COLORS[kind] }}
    >
      <Icon className="h-3 w-3" />
      {SHELTER_KIND_LABELS[kind]}
    </span>
  );
}

export default function SheltersPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === 'admin' || role === 'agency_operator';

  const [provinceId, setProvinceId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [kindFilter, setKindFilter] = useState<ShelterKind | ''>('');
  const [form, setForm] = useState<FormState | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const provinces = useProvinces();
  const allDistricts = useDistricts();
  const provinceDistricts = useMemo(
    () =>
      (allDistricts.data ?? [])
        .filter((d) => !provinceId || d.province?.id === provinceId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allDistricts.data, provinceId],
  );

  const shelters = useManagedShelters({ district: districtId || undefined, kind: kindFilter || undefined });
  const list = useMemo(
    () => (shelters.data ?? []).filter((s) => !provinceId || s.district.province?.id === provinceId),
    [shelters.data, provinceId],
  );
  const counts = useMemo(
    () => ({
      posko: list.filter((s) => s.kind === 'posko' && s.isActive).length,
      assembly_point: list.filter((s) => s.kind === 'assembly_point' && s.isActive).length,
      inactive: list.filter((s) => !s.isActive).length,
    }),
    [list],
  );

  const saveShelter = useSaveShelter();
  const deleteShelter = useDeleteShelter();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const chooseDistrictFilter = (id: string) => {
    setDistrictId(id);
    const c = allDistricts.data?.find((d) => d.id === id)?.geom?.coordinates;
    if (c) setFocus({ lat: c[1], lng: c[0], zoom: 11 });
  };

  const pickPoint = (lat: number, lng: number) => {
    if (!canManage) return;
    setForm((current) => {
      const base = current ?? emptyForm(districtId);
      const suggested = base.districtTouched ? null : nearestDistrict(allDistricts.data ?? [], lat, lng);
      return {
        ...base,
        latitude: lat.toFixed(6),
        longitude: lng.toFixed(6),
        districtId: suggested?.id ?? base.districtId,
      };
    });
  };

  const startNew = () => {
    setForm(emptyForm(districtId));
    toast.info('Klik peta untuk menaruh titik posko atau titik kumpul.');
  };

  // Viewers without manage rights just get the map centred on the site.
  const open = (shelter: Shelter) => {
    if (canManage) setForm(formFromShelter(shelter));
    const point = shelterLatLng(shelter);
    if (point) setFocus({ ...point, zoom: 15 });
  };

  const lat = Number(form?.latitude);
  const lng = Number(form?.longitude);
  const hasPoint =
    !!form && form.latitude !== '' && form.longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const capacity = Number(form?.capacity);
  const occupancy = Number(form?.currentOccupancy || 0);
  const formError = !form
    ? null
    : !form.name.trim()
      ? 'Isi nama lokasi.'
      : !hasPoint
        ? 'Klik peta untuk menaruh titik.'
        : !form.districtId
          ? 'Pilih kabupaten/kota.'
          : form.capacity === '' || !Number.isInteger(capacity) || capacity < 0
            ? 'Isi kapasitas (angka bulat, 0 jika tidak dibatasi).'
            : !Number.isInteger(occupancy) || occupancy < 0
              ? 'Jumlah terisi harus angka bulat.'
              : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || formError) return;
    const input: ShelterInput = {
      districtId: form.districtId,
      name: form.name.trim(),
      kind: form.kind,
      latitude: lat,
      longitude: lng,
      capacity,
      currentOccupancy: occupancy,
      address: form.address.trim(),
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      notes: form.notes.trim(),
      isActive: form.isActive,
    };
    saveShelter.mutate(
      { id: form.id, input },
      {
        onSuccess: () => {
          toast.success(form.id ? 'Perubahan disimpan' : `${SHELTER_KIND_LABELS[form.kind]} ditambahkan`);
          setForm(null);
        },
        onError: () => toast.error('Gagal menyimpan. Periksa isian lalu coba lagi.'),
      },
    );
  };

  const remove = () => {
    if (!form?.id) return;
    deleteShelter.mutate(form.id, {
      onSuccess: () => {
        toast.success('Lokasi dihapus');
        setConfirmDelete(false);
        setForm(null);
      },
      onError: () => toast.error('Gagal menghapus lokasi'),
    });
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={Tent}
        eyebrow="Operations"
        title="Posko & Titik Kumpul"
        description="Tetapkan posko pengungsian dan titik kumpul warga per kabupaten/kota. Lokasi yang aktif langsung tampil di portal warga (halaman Darurat dan Peta) untuk warga di wilayah tersebut."
        actions={
          canManage && (
            <Button onClick={startNew} disabled={!!form && !form.id}>
              <Plus className="mr-2 h-4 w-4" /> Tambah titik
            </Button>
          )
        }
      />

      {!canManage && (
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          Hanya admin dan operator lembaga yang bisa menambah atau mengubah lokasi. Anda bisa melihat daftarnya.
        </p>
      )}

      <Card className="py-0">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label="Provinsi" htmlFor="filter-province">
            <select
              id="filter-province"
              className={selectClass}
              value={provinceId}
              onChange={(event) => {
                setProvinceId(event.target.value);
                setDistrictId('');
              }}
            >
              <option value="">Semua provinsi</option>
              {(provinces.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kabupaten/Kota" htmlFor="filter-district">
            <select
              id="filter-district"
              className={selectClass}
              value={districtId}
              onChange={(event) => chooseDistrictFilter(event.target.value)}
            >
              <option value="">Semua kabupaten/kota</option>
              {provinceDistricts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <div role="group" aria-label="Jenis lokasi" className="flex gap-1 rounded-lg bg-muted p-1 sm:col-span-2 lg:col-span-1">
            {[{ value: '' as const, label: 'Semua' }, ...KINDS.map((k) => ({ value: k, label: SHELTER_KIND_LABELS[k] }))].map(
              (option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  aria-pressed={kindFilter === option.value}
                  onClick={() => setKindFilter(option.value)}
                  className={cn(
                    'h-8 flex-1 rounded-md px-3 text-sm whitespace-nowrap transition-colors',
                    kindFilter === option.value
                      ? 'bg-card font-semibold text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="py-0">
          <CardContent className="relative h-[520px] p-3 sm:h-[680px]">
            <ShelterManagerMap
              shelters={list}
              selectedId={form?.id ?? null}
              draft={hasPoint && form ? { lat, lng, kind: form.kind } : null}
              focus={focus}
              onPick={pickPoint}
              onSelect={(id) => {
                const shelter = list.find((s) => s.id === id);
                if (shelter) open(shelter);
              }}
            />
            <div className="pointer-events-none absolute top-6 left-6 z-10 flex flex-wrap gap-2 text-xs">
              {KINDS.map((kind) => (
                <span key={kind} className="rounded-full bg-card/95 px-2.5 py-1 font-medium shadow-sm">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SHELTER_KIND_COLORS[kind] }} />
                  {SHELTER_KIND_LABELS[kind]} · {counts[kind]}
                </span>
              ))}
              {counts.inactive > 0 && (
                <span className="rounded-full bg-card/95 px-2.5 py-1 font-medium text-muted-foreground shadow-sm">
                  Nonaktif · {counts.inactive}
                </span>
              )}
            </div>
            {form && !hasPoint && (
              <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center">
                <span className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg">
                  <MapPin className="h-4 w-4" /> Klik peta untuk menaruh titik
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {form ? (
          <Card>
            <CardHeader>
              <CardTitle>{form.id ? 'Ubah lokasi' : 'Lokasi baru'}</CardTitle>
              <CardDescription>
                Klik atau geser titik di peta untuk menentukan lokasi. Nama, alamat dan kontak tampil apa adanya di portal warga.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid gap-4">
                <div role="radiogroup" aria-label="Jenis lokasi" className="grid grid-cols-2 gap-2">
                  {KINDS.map((kind) => {
                    const Icon = KIND_ICONS[kind];
                    const active = form.kind === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => set('kind', kind)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                          active ? 'border-transparent text-white' : 'border-border hover:bg-muted',
                        )}
                        style={active ? { background: SHELTER_KIND_COLORS[kind] } : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="grid leading-tight">
                          <span className="font-semibold">{SHELTER_KIND_LABELS[kind]}</span>
                          <span className={cn('text-xs', active ? 'text-white/80' : 'text-muted-foreground')}>
                            {kind === 'posko' ? 'Tempat mengungsi' : 'Tempat berkumpul'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <Field label="Nama" htmlFor="shelter-name">
                  <Input
                    id="shelter-name"
                    maxLength={200}
                    placeholder={form.kind === 'posko' ? 'Posko GOR Desa Sukamaju' : 'Lapangan Balai Desa'}
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                  />
                </Field>

                <Field
                  label="Kabupaten/Kota"
                  htmlFor="shelter-district"
                  hint={form.districtTouched ? undefined : 'Terisi otomatis dari titik terdekat. Periksa jika lokasi dekat perbatasan.'}
                >
                  <select
                    id="shelter-district"
                    className={selectClass}
                    value={form.districtId}
                    onChange={(event) =>
                      setForm((current) =>
                        current ? { ...current, districtId: event.target.value, districtTouched: true } : current,
                      )
                    }
                  >
                    <option value="">Pilih kabupaten/kota</option>
                    {(allDistricts.data ?? [])
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.province ? ` — ${d.province.name}` : ''}
                        </option>
                      ))}
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude" htmlFor="shelter-lat">
                    <Input
                      id="shelter-lat"
                      inputMode="decimal"
                      value={form.latitude}
                      onChange={(event) => set('latitude', event.target.value)}
                    />
                  </Field>
                  <Field label="Longitude" htmlFor="shelter-lng">
                    <Input
                      id="shelter-lng"
                      inputMode="decimal"
                      value={form.longitude}
                      onChange={(event) => set('longitude', event.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kapasitas (orang)" htmlFor="shelter-capacity">
                    <Input
                      id="shelter-capacity"
                      type="number"
                      min={0}
                      value={form.capacity}
                      onChange={(event) => set('capacity', event.target.value)}
                    />
                  </Field>
                  <Field label="Sudah terisi" htmlFor="shelter-occupancy">
                    <Input
                      id="shelter-occupancy"
                      type="number"
                      min={0}
                      value={form.currentOccupancy}
                      onChange={(event) => set('currentOccupancy', event.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Alamat / patokan" htmlFor="shelter-address">
                  <Input
                    id="shelter-address"
                    maxLength={300}
                    placeholder="Jl. Merdeka No. 1, depan masjid"
                    value={form.address}
                    onChange={(event) => set('address', event.target.value)}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Penanggung jawab" htmlFor="shelter-contact">
                    <Input
                      id="shelter-contact"
                      maxLength={120}
                      value={form.contactName}
                      onChange={(event) => set('contactName', event.target.value)}
                    />
                  </Field>
                  <Field label="No. telepon" htmlFor="shelter-phone">
                    <Input
                      id="shelter-phone"
                      type="tel"
                      maxLength={40}
                      value={form.contactPhone}
                      onChange={(event) => set('contactPhone', event.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Catatan (fasilitas, jam buka)" htmlFor="shelter-notes">
                  <textarea
                    id="shelter-notes"
                    className={textareaClass}
                    maxLength={2000}
                    value={form.notes}
                    onChange={(event) => set('notes', event.target.value)}
                  />
                </Field>

                <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="grid text-sm">
                    <span className="font-medium">Aktif</span>
                    <span className="text-xs text-muted-foreground">Nonaktif = disembunyikan dari portal warga</span>
                  </span>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => set('isActive', checked)} />
                </label>

                {formError && <p className="text-sm text-muted-foreground">{formError}</p>}

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={!!formError || saveShelter.isPending}>
                    {saveShelter.isPending ? 'Menyimpan…' : 'Simpan'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setForm(null)}>
                    Batal
                  </Button>
                  {form.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border py-4">
              <CardTitle className="text-base">Daftar lokasi</CardTitle>
              <CardDescription>
                {list.length.toLocaleString('id-ID')} lokasi
                {districtId ? ' di kabupaten/kota ini' : provinceId ? ' di provinsi ini' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[620px] overflow-y-auto p-0">
              {shelters.isLoading && (
                <div className="grid gap-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              )}
              {!shelters.isLoading && list.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Belum ada posko atau titik kumpul di sini.
                  {canManage && ' Klik "Tambah titik" lalu klik peta.'}
                </p>
              )}
              <ul>
                {list.map((shelter) => (
                  <li key={shelter.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => open(shelter)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        !shelter.isActive && 'opacity-60',
                      )}
                    >
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{shelter.name}</span>
                          <KindBadge kind={shelter.kind} />
                          {!shelter.isActive && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              Nonaktif
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {shelter.district.name}
                          {shelter.address ? ` · ${shelter.address}` : ''}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {(shelter.currentOccupancy ?? 0).toLocaleString('id-ID')} / {shelter.capacity.toLocaleString('id-ID')} orang
                        </span>
                      </span>
                      {canManage && <Pencil className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Ubah" />}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus lokasi ini?</DialogTitle>
            <DialogDescription>
              {form?.name} akan dihapus permanen dari daftar dan portal warga. Jika hanya ditutup sementara, matikan
              &quot;Aktif&quot; saja.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleteShelter.isPending}>
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

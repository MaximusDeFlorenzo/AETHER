'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, LocateFixed, MapPin, Search, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDistricts, useSubdistricts, useVillages } from '@/hooks/use-geo';
import { locationFullName } from '@/lib/citizen/geo';
import { DETECT_ERROR_TEXT, detectLocation } from '@/lib/citizen/locate';
import type { CitizenLocation } from '@/lib/citizen/types';
import { cn } from '@/lib/utils';
import type { District, Subdistrict } from '@/types/domain';

type Step = 'district' | 'subdistrict' | 'village';

const MAX_RESULTS = 60;

function matches(name: string, query: string) {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

function districtPoint(district: District): [number, number] | null {
  return district.geom?.coordinates ?? null;
}

function OptionButton({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * Three-step area picker: kabupaten/kota (required), then optional
 * kecamatan and desa/kelurahan. Stopping early is fine — alarms aimed at a
 * finer area still reach people who only picked the coarser one.
 */
export function LocationPicker({
  open,
  onOpenChange,
  onSelect,
  title = 'Pilih wilayah Anda',
  description = 'Kami pakai wilayah ini untuk menampilkan status bahaya dan mengirim peringatan darurat. Disimpan di browser perangkat ini saja, tidak dikirim ke akun mana pun.',
  current = null,
  onReset,
  alarmsEnabled = false,
  mode = 'self',
  autoLocate = false,
  onAutoLocateChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (location: CitizenLocation) => void;
  title?: string;
  description?: string;
  /** The saved area, shown with a reset option (omitted for family areas). */
  current?: CitizenLocation | null;
  onReset?: () => Promise<void> | void;
  alarmsEnabled?: boolean;
  /** 'family' hides GPS detection — a relative's area isn't where you stand. */
  mode?: 'self' | 'family';
  autoLocate?: boolean;
  onAutoLocateChange?: (enabled: boolean) => void;
}) {
  const [followMe, setFollowMe] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [step, setStep] = useState<Step>('district');
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState<District | null>(null);
  const [subdistrict, setSubdistrict] = useState<Subdistrict | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const districts = useDistricts();
  const subdistricts = useSubdistricts({ districtId: district?.id, limit: 200 });
  const villages = useVillages({ subdistrictId: subdistrict?.id, limit: 200 });

  const reset = () => {
    setConfirmReset(false);
    setStep('district');
    setQuery('');
    setDistrict(null);
    setSubdistrict(null);
    setLocateError(null);
  };

  const finish = (location: CitizenLocation, viaGps = false) => {
    // A manual choice must not be overwritten by GPS a minute later.
    if (mode === 'self' && !viaGps) onAutoLocateChange?.(false);
    onSelect(location);
    onOpenChange(false);
    reset();
  };

  const baseLocation = (d: District): CitizenLocation => ({
    districtId: d.id,
    districtName: d.name,
    provinceName: d.province?.name ?? null,
    subdistrictId: null,
    subdistrictName: null,
    villageId: null,
    villageName: null,
    point: districtPoint(d),
  });

  const chooseDistrict = (d: District) => {
    setDistrict(d);
    setQuery('');
    setStep('subdistrict');
  };

  const chooseSubdistrict = (s: Subdistrict) => {
    setSubdistrict(s);
    setQuery('');
    setStep('village');
  };

  // Full GPS detection (kabupaten → desa) via /public/locate. In "self"
  // mode the citizen can also opt into keeping it updated as they move.
  const useMyLocation = async () => {
    setLocating(true);
    setLocateError(null);
    const result = await detectLocation();
    setLocating(false);
    if (!result.ok) {
      setLocateError(DETECT_ERROR_TEXT[result.reason]);
      return;
    }
    if (mode === 'self') onAutoLocateChange?.(followMe);
    finish(result.location, true);
  };

  const districtResults = useMemo(() => {
    const all = districts.data ?? [];
    const filtered = query.trim() ? all.filter((d) => matches(d.name, query)) : all;
    return filtered.slice(0, MAX_RESULTS);
  }, [districts.data, query]);

  const subdistrictResults = useMemo(() => {
    const all = subdistricts.data?.data ?? [];
    return query.trim() ? all.filter((s) => matches(s.name, query)) : all;
  }, [subdistricts.data, query]);

  const villageResults = useMemo(() => {
    const all = villages.data?.data ?? [];
    return query.trim() ? all.filter((v) => matches(v.name, query)) : all;
  }, [villages.data, query]);

  const loading =
    (step === 'district' && districts.isLoading) ||
    (step === 'subdistrict' && subdistricts.isLoading) ||
    (step === 'village' && villages.isLoading);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="z-[70] flex max-h-[min(640px,calc(100svh-2rem))] flex-col gap-3 p-0 font-citizen sm:max-w-md">
        <DialogHeader className="gap-1 px-5 pt-5">
          <DialogTitle className="text-lg font-extrabold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {current && onReset && step === 'district' && (
          <div className="mx-5 grid gap-2 rounded-2xl bg-muted p-3">
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-xs font-bold text-muted-foreground">Wilayah saat ini</span>
                <span className="font-extrabold">{locationFullName(current)}</span>
              </span>
            </p>
            {confirmReset ? (
              <div className="grid gap-2">
                <p className="text-xs">
                  Hapus wilayah ini dari perangkat ini?
                  {alarmsEnabled && ' Peringatan darurat untuk wilayah ini juga akan dimatikan.'}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={async () => {
                      setResetting(true);
                      try {
                        await onReset();
                      } finally {
                        setResetting(false);
                        onOpenChange(false);
                        reset();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-lv-awas px-3 py-2 text-sm font-extrabold text-white disabled:opacity-60 dark:text-background"
                  >
                    {resetting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Ya, hapus
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-extrabold"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 justify-self-start text-sm font-extrabold text-lv-awas"
              >
                <Trash2 className="h-4 w-4" /> Reset wilayah
              </button>
            )}
            <p className="text-xs text-muted-foreground">Atau pilih wilayah baru di bawah untuk menggantinya.</p>
          </div>
        )}

        <div className="flex items-center gap-2 px-5 text-xs font-bold text-muted-foreground">
          {(['district', 'subdistrict', 'village'] as Step[]).map((s, index) => (
            <span
              key={s}
              className={cn(
                'rounded-full px-2.5 py-1',
                step === s ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {index + 1}. {s === 'district' ? 'Kab/Kota' : s === 'subdistrict' ? 'Kecamatan' : 'Desa'}
            </span>
          ))}
        </div>

        {step !== 'district' && district && (
          <div className="flex items-center justify-between gap-2 px-5">
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setStep(step === 'village' ? 'subdistrict' : 'district');
              }}
              className="inline-flex items-center gap-1 text-sm font-bold text-primary"
            >
              <ChevronLeft className="h-4 w-4" /> Kembali
            </button>
            <span className="truncate text-sm font-bold">
              {step === 'village' && subdistrict ? `Kec. ${subdistrict.name}` : district.name}
            </span>
          </div>
        )}

        <div className="relative px-5">
          <Search className="pointer-events-none absolute top-1/2 left-8 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="citizen-location-search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              step === 'district'
                ? 'Cari kabupaten/kota, mis. Sukabumi'
                : step === 'subdistrict'
                  ? 'Cari kecamatan'
                  : 'Cari desa/kelurahan'
            }
            className="h-11 rounded-xl pl-9 text-base"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {step === 'district' && mode === 'self' && (
            <div className="mb-2 grid gap-2 rounded-2xl border border-primary/30 bg-accent/50 p-3">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-[15px] font-extrabold text-primary-foreground disabled:opacity-70"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {locating ? 'Mendeteksi lokasi Anda…' : 'Deteksi lokasi saya otomatis'}
              </button>
              <label className="flex items-start gap-2 text-sm">
                <input
                  id="follow-me"
                  type="checkbox"
                  checked={followMe}
                  onChange={(event) => setFollowMe(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                />
                <span>
                  <strong>Perbarui otomatis saat saya berpindah</strong>
                  <span className="block text-xs text-muted-foreground">
                    Dicek setiap kali web dibuka. Lokasi hanya dipakai untuk menentukan wilayah, tidak disimpan.
                  </span>
                </span>
              </label>
              {autoLocate && (
                <button
                  type="button"
                  onClick={() => onAutoLocateChange?.(false)}
                  className="justify-self-start text-xs font-bold text-muted-foreground underline"
                >
                  Matikan pembaruan otomatis
                </button>
              )}
              {locateError && <p className="text-xs font-bold text-lv-awas">{locateError}</p>}
              <p className="text-center text-xs font-bold text-muted-foreground">atau pilih manual</p>
            </div>
          )}

          {step === 'subdistrict' && district && (
            <button
              type="button"
              onClick={() => finish(baseLocation(district))}
              className="mb-1 w-full rounded-xl border border-dashed border-primary px-3 py-2.5 text-left text-sm font-bold text-primary hover:bg-accent"
            >
              Cukup sampai {district.name}
            </button>
          )}
          {step === 'village' && district && subdistrict && (
            <button
              type="button"
              onClick={() =>
                finish({ ...baseLocation(district), subdistrictId: subdistrict.id, subdistrictName: subdistrict.name })
              }
              className="mb-1 w-full rounded-xl border border-dashed border-primary px-3 py-2.5 text-left text-sm font-bold text-primary hover:bg-accent"
            >
              Cukup sampai Kec. {subdistrict.name}
            </button>
          )}

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && step === 'district' &&
            districtResults.map((d) => (
              <OptionButton key={d.id} title={d.name} subtitle={d.province?.name} onClick={() => chooseDistrict(d)} />
            ))}
          {!loading && step === 'subdistrict' &&
            subdistrictResults.map((s) => (
              <OptionButton key={s.id} title={`Kec. ${s.name}`} onClick={() => chooseSubdistrict(s)} />
            ))}
          {!loading && step === 'village' && district && subdistrict &&
            villageResults.map((v) => (
              <OptionButton
                key={v.id}
                title={v.name}
                onClick={() =>
                  finish({
                    ...baseLocation(district),
                    subdistrictId: subdistrict.id,
                    subdistrictName: subdistrict.name,
                    villageId: v.id,
                    villageName: v.name,
                  })
                }
              />
            ))}

          {!loading &&
            ((step === 'district' && districtResults.length === 0) ||
              (step === 'subdistrict' && subdistrictResults.length === 0) ||
              (step === 'village' && villageResults.length === 0)) && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Tidak ditemukan. Coba ejaan lain.
              </p>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

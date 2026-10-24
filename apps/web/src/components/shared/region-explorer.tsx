'use client';

import { useState } from 'react';
import { MapPin, Info } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useProvinces,
  useDistricts,
  useDistrict,
  useSubdistricts,
  useSubdistrict,
  useSubdistrictPopulationAggregate,
  useVillages,
  useVillage,
  usePopulation,
} from '@/hooks/use-geo';
import { useVillagePopulations } from '@/hooks/use-village-population-import';

// Provinsi → Kabupaten/Kota → Kecamatan → Kelurahan/Desa. Changing a level
// clears everything below it — a stale child selection referencing the old
// parent must never survive a parent change. Kecamatan/kelurahan lists are
// always fetched scoped to their selected parent (never the nationwide
// table) and are themselves paginated server-side (default 50/page); with
// >50 results, narrow with the search box rather than paging through by
// hand for now (no "load more" control yet — see final report's remaining
// gaps).
export function RegionExplorer() {
  const [provinceId, setProvinceId] = useState<string>();
  const [districtId, setDistrictId] = useState<string>();
  const [subdistrictId, setSubdistrictId] = useState<string>();
  const [villageId, setVillageId] = useState<string>();
  const [subdistrictSearch, setSubdistrictSearch] = useState('');
  const [villageSearch, setVillageSearch] = useState('');

  const { data: provinces, isLoading: provincesLoading } = useProvinces();
  const { data: districts, isLoading: districtsLoading } = useDistricts(provinceId);
  const { data: subdistrictsPage, isLoading: subdistrictsLoading } = useSubdistricts({
    districtId,
    search: subdistrictSearch || undefined,
  });
  const { data: villagesPage, isLoading: villagesLoading } = useVillages({
    subdistrictId,
    search: villageSearch || undefined,
  });

  const selectedLevel = villageId
    ? 'kelurahan_desa'
    : subdistrictId
      ? 'kecamatan'
      : districtId
        ? 'kabupaten_kota'
        : undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Navigasi Wilayah</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Provinsi</label>
              <Select
                disabled={provincesLoading}
                value={provinceId ?? null}
                onValueChange={(v) => {
                  setProvinceId(v ?? undefined);
                  setDistrictId(undefined);
                  setSubdistrictId(undefined);
                  setVillageId(undefined);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih provinsi" />
                </SelectTrigger>
                <SelectContent>
                  {provinces?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Kabupaten/Kota
              </label>
              <Select
                disabled={!provinceId || districtsLoading}
                value={districtId ?? null}
                onValueChange={(v) => {
                  setDistrictId(v ?? undefined);
                  setSubdistrictId(undefined);
                  setVillageId(undefined);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih kabupaten/kota" />
                </SelectTrigger>
                <SelectContent>
                  {districts?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kecamatan</label>
              <Input
                placeholder="Cari kecamatan..."
                className="mb-1.5"
                disabled={!districtId}
                value={subdistrictSearch}
                onChange={(e) => setSubdistrictSearch(e.target.value)}
              />
              <Select
                disabled={!districtId || subdistrictsLoading}
                value={subdistrictId ?? null}
                onValueChange={(v) => {
                  setSubdistrictId(v ?? undefined);
                  setVillageId(undefined);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih kecamatan" />
                </SelectTrigger>
                <SelectContent>
                  {subdistrictsPage?.data.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {subdistrictsPage && subdistrictsPage.meta.total > subdistrictsPage.data.length && (
                <p className="text-[11px] text-muted-foreground">
                  Menampilkan {subdistrictsPage.data.length} dari {subdistrictsPage.meta.total} —
                  persempit dengan pencarian.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Kelurahan/Desa
              </label>
              <Input
                placeholder="Cari kelurahan/desa..."
                className="mb-1.5"
                disabled={!subdistrictId}
                value={villageSearch}
                onChange={(e) => setVillageSearch(e.target.value)}
              />
              <Select
                disabled={!subdistrictId || villagesLoading}
                value={villageId ?? null}
                onValueChange={(v) => setVillageId(v ?? undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih kelurahan/desa" />
                </SelectTrigger>
                <SelectContent>
                  {villagesPage?.data.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {villagesPage && villagesPage.meta.total > villagesPage.data.length && (
                <p className="text-[11px] text-muted-foreground">
                  Menampilkan {villagesPage.data.length} dari {villagesPage.meta.total} —
                  persempit dengan pencarian.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <RegionDetailPanel
        level={selectedLevel}
        districtId={districtId}
        subdistrictId={subdistrictId}
        villageId={villageId}
      />
    </div>
  );
}

function RegionDetailPanel({
  level,
  districtId,
  subdistrictId,
  villageId,
}: {
  level: 'kabupaten_kota' | 'kecamatan' | 'kelurahan_desa' | undefined;
  districtId: string | undefined;
  subdistrictId: string | undefined;
  villageId: string | undefined;
}) {
  const { data: district } = useDistrict(level === 'kabupaten_kota' ? districtId : undefined);
  const { data: subdistrict } = useSubdistrict(level === 'kecamatan' ? subdistrictId : undefined);
  const { data: village } = useVillage(level === 'kelurahan_desa' ? villageId : undefined);
  const { data: population, isLoading: populationLoading } = usePopulation(
    level === 'kabupaten_kota' ? districtId : undefined,
  );
  const { data: villagePopulations, isLoading: villagePopulationsLoading } =
    useVillagePopulations(level === 'kelurahan_desa' ? villageId : undefined);
  const { data: populationAggregate, isLoading: populationAggregateLoading } =
    useSubdistrictPopulationAggregate(level === 'kecamatan' ? subdistrictId : undefined);

  if (!level) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Wilayah</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Pilih wilayah dari navigasi di samping untuk melihat detail.
          </p>
        </CardContent>
      </Card>
    );
  }

  const region =
    level === 'kabupaten_kota' ? district : level === 'kecamatan' ? subdistrict : village;
  const levelLabel =
    level === 'kabupaten_kota'
      ? 'Kabupaten/Kota'
      : level === 'kecamatan'
        ? 'Kecamatan'
        : 'Kelurahan/Desa';
  const code =
    level === 'kabupaten_kota'
      ? district?.bpsCode
      : level === 'kecamatan'
        ? subdistrict?.code
        : village?.code;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{region?.name ?? <Skeleton className="h-5 w-32" />}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{levelLabel}</Badge>
          {code && (
            <Badge variant="outline" className="font-mono">
              {code}
            </Badge>
          )}
          {region && <Badge variant="outline">sistem kode: {region.codeSystem}</Badge>}
        </div>

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Info className="h-3.5 w-3.5" /> Ketersediaan data
          </p>
          <ul className="space-y-1 text-xs">
            <li>Data administratif (kode/nama/hierarki): tersedia</li>
            <li>
              Assessment risiko:{' '}
              {level === 'kabupaten_kota'
                ? 'tersedia (lihat halaman Risk Assessments)'
                : 'belum didukung di tingkat ini — lihat "Kabupaten/Kota induk" di bawah'}
            </li>
          </ul>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Populasi</p>
          {level === 'kecamatan' ? (
            populationAggregateLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : populationAggregate && populationAggregate.coveredVillages > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold tabular-nums">
                  {populationAggregate.totalPopulation?.toLocaleString('id-ID') ?? '—'} jiwa
                  {populationAggregate.male != null && populationAggregate.female != null && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      (L: {populationAggregate.male.toLocaleString('id-ID')} · P:{' '}
                      {populationAggregate.female.toLocaleString('id-ID')})
                    </span>
                  )}
                </p>
                <p
                  className={
                    populationAggregate.isComplete
                      ? 'text-xs text-muted-foreground'
                      : 'text-xs text-amber-600 dark:text-amber-400'
                  }
                >
                  <strong>Hasil agregasi</strong> dari {populationAggregate.coveredVillages} dari{' '}
                  {populationAggregate.totalVillages} desa/kelurahan (
                  {populationAggregate.coveragePercentage}% cakupan)
                  {!populationAggregate.isComplete &&
                    ' — BUKAN total resmi kecamatan ini, sebagian desa belum punya data'}
                  .
                </p>
                <p className="text-xs text-muted-foreground">
                  Sumber: {populationAggregate.sourceName}
                  {populationAggregate.periodStatus === 'confirmed'
                    ? ` · periode ${populationAggregate.periodYear}`
                    : ' · periode belum diketahui'}
                  {populationAggregate.otherGroupsAvailable > 0 &&
                    ` · ${populationAggregate.otherGroupsAvailable} kombinasi sumber/periode lain juga tersedia untuk sebagian desa di kecamatan ini (tidak dicampur ke angka di atas)`}
                </p>
                {populationAggregate.villagesWithTotalPopulation <
                  populationAggregate.coveredVillages && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {populationAggregate.coveredVillages -
                      populationAggregate.villagesWithTotalPopulation}{' '}
                    dari desa yang tercakup punya catatan tapi nilai populasinya kosong di
                    sumber — tidak dihitung sebagai nol.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Belum ada data populasi desa/kelurahan yang diimpor untuk kecamatan ini — sumber
                yang sudah diimpor (CSV Prodeskel) berada di tingkat kelurahan/desa (lihat
                docs/DATABASE_SCHEMA.md §6c-6e). Populasi kabupaten/kota induk hanya konteks di
                bawah, bukan populasi kecamatan ini.
              </p>
            )
          ) : level === 'kelurahan_desa' ? (
            villagePopulationsLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : villagePopulations && villagePopulations.length > 0 ? (
              <div className="space-y-2">
                {villagePopulations.map((vp) => (
                  <div key={vp.id} className="rounded-md border border-border/60 p-2 text-xs">
                    <p className="text-sm font-semibold tabular-nums">
                      {vp.totalPopulation?.toLocaleString('id-ID') ?? '—'} jiwa
                      {vp.male != null && vp.female != null && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          (L: {vp.male.toLocaleString('id-ID')} · P:{' '}
                          {vp.female.toLocaleString('id-ID')})
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      Periode:{' '}
                      {vp.periodStatus === 'confirmed'
                        ? vp.periodYear
                        : 'belum diketahui'}
                      {vp.reportedDate && ` · dilaporkan sumber pada ${vp.reportedDate}`}
                    </p>
                    <p className="text-muted-foreground">Sumber: {vp.sourceName}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Belum ada data populasi yang diimpor untuk desa/kelurahan ini.
              </p>
            )
          ) : populationLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : population ? (
            <div className="space-y-0.5 text-xs">
              <p className="text-sm font-semibold tabular-nums">
                {population.totalPopulation.toLocaleString('id-ID')} jiwa
              </p>
              <p className="text-muted-foreground">
                {population.populationDensity.toLocaleString('id-ID')} jiwa/km² · tahun{' '}
                {population.year}
              </p>
              <p className="text-muted-foreground">Sumber: {population.source}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tidak ada data populasi.</p>
          )}
        </div>

        {level !== 'kabupaten_kota' && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Kabupaten/Kota induk (konteks)
            </p>
            <p className="text-xs text-muted-foreground">
              {level === 'kecamatan'
                ? subdistrict?.district?.name
                : village?.subdistrict?.district?.name}{' '}
              — populasi kabupaten/kota ini TIDAK sama dengan populasi{' '}
              {levelLabel.toLowerCase()} yang dipilih.
            </p>
          </div>
        )}

        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Lokasi
          </p>
          {level === 'kabupaten_kota' && district ? (
            <p className="text-xs text-muted-foreground">
              Titik referensi (GeoNames ADM2 dump) — BUKAN batas wilayah:{' '}
              {district.geom
                ? [...district.geom.coordinates]
                    .reverse()
                    .map((c) => c.toFixed(5))
                    .join(', ')
                : '—'}
            </p>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Belum tersedia untuk tingkat {levelLabel.toLowerCase()} — tidak ada koordinat atau
              batas wilayah dari sumber yang diverifikasi. Tidak ditampilkan di peta agar tidak
              menyesatkan.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

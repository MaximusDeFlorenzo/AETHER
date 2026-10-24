'use client';

import { useState } from 'react';
import { Download, Info, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useConfirmImportBatch,
  useCreateImportBatch,
  useImportBatch,
  useImportBatchRows,
  useRetryImportBatch,
  downloadImportErrorReport,
} from '@/hooks/use-village-population-import';
import { ImportRowResolverDialog } from '@/components/shared/import-row-resolver-dialog';
import type {
  PopulationImportBatchStatus,
  PopulationImportRowStatus,
  PopulationNumberFormat,
  PopulationPeriodStatus,
  VillagePopulationImportRow,
} from '@/types/domain';

const RESOLVABLE_ROW_STATUSES = new Set<PopulationImportRowStatus>([
  'hierarchy_mismatch',
  'region_not_found',
  'needs_review',
]);

const ROW_STATUS_LABELS: Record<PopulationImportRowStatus, string> = {
  valid: 'Valid',
  duplicate_in_file: 'Duplikat dalam file',
  unchanged: 'Sudah tersedia (tidak berubah)',
  conflict: 'Konflik dengan data tersimpan',
  invalid: 'Tidak valid',
  region_not_found: 'Wilayah tidak ditemukan',
  hierarchy_mismatch: 'Konflik hierarki',
  needs_review: 'Perlu peninjauan manual',
  imported: 'Diimpor',
  skipped: 'Dilewati',
};

const BATCH_STATUS_LABELS: Record<PopulationImportBatchStatus, string> = {
  uploaded: 'Menunggu worker memulai validasi',
  validating: 'Memvalidasi',
  ready: 'Siap dikonfirmasi',
  queued: 'Menunggu worker memulai impor',
  importing: 'Mengimpor',
  completed: 'Selesai',
  completed_with_errors: 'Selesai (sebagian baris dilewati)',
  failed: 'Gagal',
};

function densityExample(format: PopulationNumberFormat): string {
  return format === 'dot_thousands_separator'
    ? '"26.000" akan dibaca sebagai 26.000 (26 ribu jiwa/km²)'
    : '"26.000" akan dibaca sebagai 26 (jiwa/km²)';
}

// File → preview (backend parses/validates/matches) → review summary + rows
// → confirm (the actual write). Settings (header/format/sumber/periode) are
// immutable once a batch is created — changing them means submitting a new
// file (a fresh preview), never "editing" an existing batch's settings, so
// confirm always uses exactly what was previewed.
export function VillagePopulationImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [numberFormat, setNumberFormat] = useState<PopulationNumberFormat>(
    'dot_thousands_separator',
  );
  const [sourceName, setSourceName] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [periodStatus, setPeriodStatus] = useState<PopulationPeriodStatus>('confirmed');
  const [periodYear, setPeriodYear] = useState('');
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [rowStatusFilter, setRowStatusFilter] = useState<PopulationImportRowStatus>();
  const [resolvingRow, setResolvingRow] = useState<VillagePopulationImportRow | null>(null);

  const createBatch = useCreateImportBatch();
  const confirmBatch = useConfirmImportBatch();
  const retryBatch = useRetryImportBatch();
  const { data: batch, isLoading: batchLoading } = useImportBatch(activeBatchId);
  const { data: rowsPage, isLoading: rowsLoading } = useImportBatchRows(activeBatchId, {
    status: rowStatusFilter,
    limit: 20,
  });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !sourceName.trim()) return;
    try {
      const result = await createBatch.mutateAsync({
        file,
        hasHeaderRow,
        numberFormat,
        sourceName: sourceName.trim(),
        sourceReference: sourceReference.trim() || undefined,
        periodStatus,
        periodYear: periodStatus === 'confirmed' && periodYear ? Number(periodYear) : undefined,
      });
      setActiveBatchId(result.id);
      setRowStatusFilter(undefined);
      toast.success('File diunggah — validasi berjalan di latar belakang');
    } catch {
      toast.error('Gagal mengunggah file');
    }
  }

  async function handleConfirm() {
    if (!activeBatchId) return;
    try {
      await confirmBatch.mutateAsync(activeBatchId);
      toast.success('Impor dikonfirmasi — berjalan di latar belakang');
    } catch {
      toast.error('Gagal mengonfirmasi impor (batch mungkin sudah dikonfirmasi di tempat lain)');
    }
  }

  async function handleRetry() {
    if (!activeBatchId) return;
    try {
      await retryBatch.mutateAsync(activeBatchId);
      toast.success('Percobaan ulang dijadwalkan');
    } catch {
      toast.error('Gagal menjadwalkan percobaan ulang');
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Impor Populasi Kecamatan/Kelurahan (CSV)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-1.5">
              <Label>File CSV</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Baris pertama adalah header?</Label>
                <Select
                  value={hasHeaderRow ? 'yes' : 'no'}
                  onValueChange={(v) => setHasHeaderRow(v === 'yes')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Ya — baris pertama adalah nama kolom</SelectItem>
                    <SelectItem value="no">
                      Tidak — baris pertama sudah berisi data
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Format angka kolom Kepadatan</Label>
                <Select
                  value={numberFormat}
                  onValueChange={(v) => setNumberFormat(v as PopulationNumberFormat)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dot_thousands_separator">
                      Titik sebagai pemisah ribuan
                    </SelectItem>
                    <SelectItem value="dot_decimal_point">Titik sebagai desimal</SelectItem>
                  </SelectContent>
                </Select>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Info className="h-3 w-3" /> {densityExample(numberFormat)}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Nama sumber data</Label>
                <Input
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="mis. Prodeskel Bina Pemdes"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Referensi sumber (opsional)</Label>
                <Input
                  value={sourceReference}
                  onChange={(e) => setSourceReference(e.target.value)}
                  placeholder="URL, nomor dokumen, dsb."
                />
              </div>

              <div className="space-y-1.5">
                <Label>Periode statistik</Label>
                <Select
                  value={periodStatus}
                  onValueChange={(v) => setPeriodStatus(v as PopulationPeriodStatus)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Tahun tertentu (dikonfirmasi)</SelectItem>
                    <SelectItem value="unknown">Belum diketahui</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {periodStatus === 'confirmed' && (
                <div className="space-y-1.5">
                  <Label>Tahun periode</Label>
                  <Input
                    type="number"
                    value={periodYear}
                    onChange={(e) => setPeriodYear(e.target.value)}
                    placeholder="2024"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Ini periode statistik yang Anda konfirmasi — bukan tanggal per baris di
                    kolom &quot;Tanggal&quot; sumber, dan bukan tahun saat mengunggah.
                  </p>
                </div>
              )}
            </div>

            <Button type="submit" disabled={!file || !sourceName.trim() || createBatch.isPending}>
              <Upload className="mr-1.5 h-4 w-4" />
              {createBatch.isPending ? 'Memproses...' : 'Unggah dan Pratinjau'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {activeBatchId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Batch Impor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {batchLoading || !batch ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={batch.status === 'failed' ? 'destructive' : 'outline'}>
                    {BATCH_STATUS_LABELS[batch.status]}
                  </Badge>
                  {batch.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetry}
                      disabled={retryBatch.isPending}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      {retryBatch.isPending ? 'Menjadwalkan...' : 'Coba Lagi'}
                    </Button>
                  )}
                </div>

                {batch.status === 'failed' && (
                  <p className="text-sm text-destructive">{batch.errorMessage}</p>
                )}

                {/* Honest progress: a processed-row count from the worker's
                    checkpoint, never a fabricated percentage — totalRows is
                    only known once validation has read the whole file. */}
                {batch.status === 'validating' && (
                  <div className="rounded-md border border-border/60 bg-secondary/40 p-3 text-sm">
                    Memvalidasi — <strong>{batch.lastValidatedRowNumber ?? 0}</strong> baris
                    diproses sejauh ini.
                  </div>
                )}
                {batch.status === 'importing' && (
                  <div className="rounded-md border border-border/60 bg-secondary/40 p-3 text-sm">
                    Mengimpor — <strong>{batch.lastImportedRowNumber ?? 0}</strong> dari{' '}
                    <strong>{batch.totalRows ?? '?'}</strong> baris diperiksa.
                  </div>
                )}
                {batch.status === 'uploaded' && (
                  <div className="rounded-md border border-border/60 bg-secondary/40 p-3 text-sm">
                    File diterima — menunggu worker validasi mengambil pekerjaan ini.
                  </div>
                )}
                {batch.status === 'queued' && (
                  <div className="rounded-md border border-border/60 bg-secondary/40 p-3 text-sm">
                    Dikonfirmasi — menunggu worker impor mengambil pekerjaan ini.
                  </div>
                )}

                {batch.totalRows != null && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    <SummaryStat label="Total baris" value={batch.totalRows} />
                    <SummaryStat
                      label="Valid, siap diimpor"
                      value={batch.validRowCount}
                      onClick={() => setRowStatusFilter('valid')}
                    />
                    <SummaryStat
                      label="Sudah tersedia"
                      value={batch.unchangedCount}
                      onClick={() => setRowStatusFilter('unchanged')}
                    />
                    <SummaryStat
                      label="Konflik"
                      value={batch.conflictCount}
                      onClick={() => setRowStatusFilter('conflict')}
                    />
                    <SummaryStat
                      label="Duplikat dalam file"
                      value={batch.duplicateInFileCount}
                      onClick={() => setRowStatusFilter('duplicate_in_file')}
                    />
                    <SummaryStat
                      label="Tidak valid / wilayah tidak ditemukan"
                      value={batch.invalidCount}
                    />
                  </div>
                )}

                {(batch.status === 'completed' || batch.status === 'completed_with_errors') && (
                  <div className="rounded-md border border-border/60 bg-secondary/40 p-3 text-sm">
                    Impor selesai — <strong>{batch.importedCount}</strong> baris diimpor,{' '}
                    <strong>{batch.skippedCount}</strong> dilewati.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {batch.totalRows != null && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void downloadImportErrorReport(
                            batch.id,
                            `import-${batch.id}-error-report.csv`,
                          )
                        }
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Unduh laporan baris bermasalah
                      </Button>

                      {/* The summary tiles above only cover valid/unchanged/
                          conflict/duplicate — hierarchy_mismatch,
                          region_not_found, and needs_review (the three
                          statuses "Selesaikan" actually applies to) have no
                          tile of their own, so without this a batch with
                          tens of thousands of rows would almost never
                          surface one by just paging through from row 1. */}
                      <Select
                        value={rowStatusFilter ?? 'all'}
                        onValueChange={(v) =>
                          setRowStatusFilter(
                            v === 'all' ? undefined : (v as PopulationImportRowStatus),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[260px] text-xs">
                          <SelectValue placeholder="Filter status baris..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Semua status</SelectItem>
                          {Object.entries(ROW_STATUS_LABELS).map(([status, label]) => (
                            <SelectItem key={status} value={status}>
                              {label}
                              {RESOLVABLE_ROW_STATUSES.has(status as PopulationImportRowStatus) &&
                                batch.status === 'ready' &&
                                ' — perlu tinjauan manual'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {rowStatusFilter && (
                    <Button variant="ghost" size="sm" onClick={() => setRowStatusFilter(undefined)}>
                      Hapus filter ({ROW_STATUS_LABELS[rowStatusFilter]})
                    </Button>
                  )}
                  {batch.status === 'ready' && (
                    <Button
                      className="ml-auto"
                      onClick={handleConfirm}
                      disabled={confirmBatch.isPending || (batch.validRowCount ?? 0) === 0}
                    >
                      {confirmBatch.isPending
                        ? 'Mengonfirmasi...'
                        : `Konfirmasi Impor (${batch.validRowCount ?? 0} baris)`}
                    </Button>
                  )}
                </div>

                {batch.totalRows != null && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Baris</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Desa/Kelurahan</TableHead>
                      <TableHead>Penduduk</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-20 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      rowsPage?.data.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{ROW_STATUS_LABELS[row.status]}</Badge>
                            {row.resolutionAction === 'rejected' && (
                              <span className="ml-1.5 text-[11px] text-muted-foreground">
                                (sudah ditinjau)
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.matchedVillage?.name ?? row.rawFields['Desa/Kelurahan'] ?? '—'}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.totalPopulation?.toLocaleString('id-ID') ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                            {row.messages.join(' | ')}
                          </TableCell>
                          <TableCell>
                            {batch.status === 'ready' &&
                              RESOLVABLE_ROW_STATUSES.has(row.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setResolvingRow(row)}
                                >
                                  Selesaikan
                                </Button>
                              )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                )}
                {batch.totalRows != null &&
                  rowsPage &&
                  rowsPage.meta.total > rowsPage.data.length && (
                    <p className="text-xs text-muted-foreground">
                      Menampilkan {rowsPage.data.length} dari {rowsPage.meta.total} baris.
                    </p>
                  )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeBatchId && (
        <ImportRowResolverDialog
          batchId={activeBatchId}
          row={resolvingRow}
          onClose={() => setResolvingRow(null)}
        />
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number | null | undefined;
  onClick?: () => void;
}) {
  const content = (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-lg font-semibold tabular-nums">{value ?? '—'}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} className="text-left">
      {content}
    </button>
  );
}

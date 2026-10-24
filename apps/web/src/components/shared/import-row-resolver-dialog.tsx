'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useResolveImportRow } from '@/hooks/use-village-population-import';
import { useVillages } from '@/hooks/use-geo';
import type { VillagePopulationImportRow } from '@/types/domain';

interface ImportRowResolverDialogProps {
  batchId: string;
  row: VillagePopulationImportRow | null;
  onClose: () => void;
}

/**
 * Manual, human-only resolution for one hierarchy_mismatch /
 * region_not_found / needs_review row (docs/DATABASE_SCHEMA.md §6c) —
 * never matches automatically. "Terima" on a hierarchy_mismatch row
 * confirms the EXISTING code-based match as-is (no village picker — if
 * that match itself is wrong, use "Tolak" instead, never force a
 * different village through this dialog); region_not_found/needs_review
 * have no usable existing match, so a village must be picked from a
 * manual nationwide name search before "Terima" is enabled. Every
 * decision here is recorded on the row (`resolvedBy`/`resolvedAt`), and
 * only works while the batch is still `ready` (before confirm).
 */
export function ImportRowResolverDialog({ batchId, row, onClose }: ImportRowResolverDialogProps) {
  const [search, setSearch] = useState('');
  const [selectedVillageId, setSelectedVillageId] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const resolveRow = useResolveImportRow();
  const { data: searchResults, isFetching: searching } = useVillages({
    search,
    limit: 10,
  });

  if (!row) return null;

  const needsVillagePicker =
    row.status === 'region_not_found' || row.status === 'needs_review';

  function handleClose() {
    setSearch('');
    setSelectedVillageId(undefined);
    setNote('');
    onClose();
  }

  async function handleAccept() {
    try {
      await resolveRow.mutateAsync({
        batchId,
        rowId: row!.id,
        action: 'accepted',
        villageId: needsVillagePicker ? selectedVillageId : undefined,
        note: note.trim() || undefined,
      });
      toast.success('Baris diterima sebagai valid');
      handleClose();
    } catch {
      toast.error('Gagal menerima baris — batch mungkin sudah tidak berstatus "ready"');
    }
  }

  async function handleReject() {
    try {
      await resolveRow.mutateAsync({
        batchId,
        rowId: row!.id,
        action: 'rejected',
        note: note.trim() || undefined,
      });
      toast.success('Baris ditandai bukan kecocokan — tetap dilewati saat impor');
      handleClose();
    } catch {
      toast.error('Gagal menolak baris');
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Selesaikan Baris #{row.rowNumber}</DialogTitle>
          <DialogDescription>
            Keputusan ini dicatat sebagai tinjauan manual oleh Anda — sistem tidak pernah
            mencocokkan wilayah secara otomatis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border/60 p-3">
            <p className="font-medium">Data di file CSV</p>
            <p className="text-muted-foreground">
              {row.rawFields['Provinsi']} / {row.rawFields['Kabupaten/Kota']} /{' '}
              {row.rawFields['Kecamatan']} / {row.rawFields['Desa/Kelurahan']}
              {row.kodePum && <> — Kode PUM: {row.kodePum}</>}
            </p>
          </div>

          {row.status === 'hierarchy_mismatch' && row.matchedVillage && (
            <div className="rounded-md border border-border/60 p-3">
              <p className="font-medium">Wilayah yang cocok berdasarkan kode di database</p>
              <p className="text-muted-foreground">
                {row.matchedVillage.name} ({row.matchedVillage.code})
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Kode sudah cocok, tapi nama pada file berbeda dari nama di database — pastikan
                ini benar-benar tempat yang sama sebelum menerima.
              </p>
            </div>
          )}

          {row.status === 'needs_review' && (
            <p className="text-xs text-muted-foreground">
              Kode PUM tidak diisi pada baris ini — sistem menemukan{' '}
              {row.candidateVillageIds?.length ?? 0} kandidat berdasarkan nama hierarki, tapi
              tidak satupun diterima otomatis. Cari dan pilih wilayah yang benar di bawah.
            </p>
          )}

          {needsVillagePicker && (
            <div className="space-y-1.5">
              <Label>Cari wilayah yang benar (manual, tidak otomatis)</Label>
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedVillageId(undefined);
                }}
                placeholder="Nama desa/kelurahan..."
              />
              {search && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border/60">
                  {searching ? (
                    <p className="p-2 text-xs text-muted-foreground">Mencari...</p>
                  ) : searchResults && searchResults.data.length > 0 ? (
                    searchResults.data.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVillageId(v.id)}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                          selectedVillageId === v.id ? 'bg-secondary' : ''
                        }`}
                      >
                        {v.name} ({v.code})
                        {v.subdistrict ? ` — ${v.subdistrict.name}` : ''}
                      </button>
                    ))
                  ) : (
                    <p className="p-2 text-xs text-muted-foreground">Tidak ada hasil</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Catatan (opsional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Alasan keputusan ini..."
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReject} disabled={resolveRow.isPending}>
            Tolak (bukan kecocokan)
          </Button>
          <Button
            onClick={handleAccept}
            disabled={resolveRow.isPending || (needsVillagePicker && !selectedVillageId)}
          >
            {resolveRow.isPending ? 'Menyimpan...' : 'Terima'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

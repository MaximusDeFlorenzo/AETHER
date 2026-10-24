'use client';

import { Layers } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RegionExplorer } from '@/components/shared/region-explorer';
import { VillagePopulationImportPanel } from '@/components/shared/village-population-import-panel';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/shared/page-header';

// Browses the full Provinsi → Kabupaten/Kota → Kecamatan → Kelurahan/Desa
// hierarchy. Deliberately separate from Risk Assessments: this page
// supports data browsing at every level (real code/name data down to
// kelurahan/desa), while risk assessment stays kabupaten/kota-only (no
// population data exists at finer levels to score against) — the detail
// panel says so explicitly per selection rather than leaving it implied.
//
// The "Impor Populasi" tab is only shown to admin/analyst client-side, as a
// convenience — the backend enforces the same roles independently
// (village-population-import.controller.ts's @Roles), so hiding the tab is
// not itself a security boundary.
export default function RegionsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canImport = role === 'admin' || role === 'analyst';

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader icon={Layers} title="Regions"
        description="Jelajahi hierarki wilayah administratif Indonesia — provinsi, kabupaten/kota, kecamatan, hingga kelurahan/desa."
      />

      {canImport ? (
        <Tabs defaultValue="explore">
          <TabsList>
            <TabsTrigger value="explore">Jelajah Wilayah</TabsTrigger>
            <TabsTrigger value="import">Impor Populasi</TabsTrigger>
          </TabsList>
          <TabsContent value="explore" className="mt-4">
            <RegionExplorer />
          </TabsContent>
          <TabsContent value="import" className="mt-4">
            <VillagePopulationImportPanel />
          </TabsContent>
        </Tabs>
      ) : (
        <RegionExplorer />
      )}
    </div>
  );
}

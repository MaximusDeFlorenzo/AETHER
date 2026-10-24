import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  District,
  Paginated,
  PopulationStatistic,
  Province,
  Subdistrict,
  SubdistrictPopulationAggregate,
  Village,
} from '@/types/domain';

// Renamed from ORION's `population/` module to `geo/` per
// docs/MIGRATION_FROM_ORION.md — same shapes, reused near-verbatim.
export function useProvinces() {
  return useQuery({
    queryKey: ['provinces'],
    queryFn: async () => {
      const { data } = await apiClient.get<Province[]>('/provinces');
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function useDistricts(provinceId?: string) {
  return useQuery({
    queryKey: ['districts', provinceId],
    queryFn: async () => {
      const { data } = await apiClient.get<District[]>('/districts', {
        params: provinceId ? { province: provinceId } : undefined,
      });
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function usePopulation(districtId: string | undefined) {
  return useQuery({
    queryKey: ['population', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<PopulationStatistic>(`/population/${districtId}`);
      return data;
    },
    enabled: !!districtId,
  });
}

export function useDistrict(districtId: string | undefined) {
  return useQuery({
    queryKey: ['district', districtId],
    queryFn: async () => {
      const { data } = await apiClient.get<District>(`/districts/${districtId}`);
      return data;
    },
    enabled: !!districtId,
  });
}

// Kecamatan, scoped by parent district — never fetches nationwide. `search`
// filters by name; pass neither to page through all subdistricts of a
// district (still paginated server-side, never a full dump).
export function useSubdistricts(params: {
  districtId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { districtId, search, page = 1, limit = 50 } = params;
  return useQuery({
    queryKey: ['subdistricts', districtId, search, page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<Paginated<Subdistrict>>('/subdistricts', {
        params: { district: districtId, search, page, limit },
      });
      return data;
    },
    enabled: !!districtId || !!search,
  });
}

export function useSubdistrict(subdistrictId: string | undefined) {
  return useQuery({
    queryKey: ['subdistrict', subdistrictId],
    queryFn: async () => {
      const { data } = await apiClient.get<Subdistrict>(`/subdistricts/${subdistrictId}`);
      return data;
    },
    enabled: !!subdistrictId,
  });
}

// A SUM of the kecamatan's villages' imported population — NOT the
// kecamatan's own official figure. See SubdistrictPopulationAggregate's
// comment; always render `coveragePercentage`/`isComplete` alongside
// `totalPopulation`, never the number alone.
export function useSubdistrictPopulationAggregate(subdistrictId: string | undefined) {
  return useQuery({
    queryKey: ['subdistrict-population-aggregate', subdistrictId],
    queryFn: async () => {
      const { data } = await apiClient.get<SubdistrictPopulationAggregate>(
        `/subdistricts/${subdistrictId}/population-aggregate`,
      );
      return data;
    },
    enabled: !!subdistrictId,
  });
}

// Kelurahan/desa, scoped by parent subdistrict — never fetches nationwide.
export function useVillages(params: {
  subdistrictId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { subdistrictId, search, page = 1, limit = 50 } = params;
  return useQuery({
    queryKey: ['villages', subdistrictId, search, page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<Paginated<Village>>('/villages', {
        params: { subdistrict: subdistrictId, search, page, limit },
      });
      return data;
    },
    enabled: !!subdistrictId || !!search,
  });
}

export function useVillage(villageId: string | undefined) {
  return useQuery({
    queryKey: ['village', villageId],
    queryFn: async () => {
      const { data } = await apiClient.get<Village>(`/villages/${villageId}`);
      return data;
    },
    enabled: !!villageId,
  });
}

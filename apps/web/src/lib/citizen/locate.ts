import { apiClient } from '@/lib/api-client';
import type { CitizenLocation } from './types';

export type LocatePrecision = 'desa' | 'kecamatan' | 'kabupaten';

interface LocateResponse {
  district: { id: string; name: string; provinceName: string | null; point: [number, number] | null };
  subdistrict: { id: string; name: string } | null;
  village: { id: string; name: string } | null;
  precision: LocatePrecision;
  method: 'reverse-geocode' | 'nearest';
}

export type DetectResult =
  | { ok: true; location: CitizenLocation; precision: LocatePrecision }
  | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' | 'failed' };

export function geolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** 'granted' | 'prompt' | 'denied', or null where the Permissions API is missing (older Safari). */
export async function geolocationPermission(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return null;
  }
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 2 * 60 * 1000,
    }),
  );
}

/**
 * GPS → the citizen's kabupaten/kota, and kecamatan/desa when they can be
 * matched (via /public/locate). Prompts for location permission the first
 * time, so call it from a click unless permission is already granted.
 */
export async function detectLocation(): Promise<DetectResult> {
  if (!geolocationSupported()) return { ok: false, reason: 'unsupported' };
  let position: GeolocationPosition;
  try {
    position = await currentPosition();
  } catch (error) {
    const code = (error as GeolocationPositionError).code;
    return { ok: false, reason: code === 1 ? 'denied' : 'unavailable' };
  }
  try {
    const { data } = await apiClient.get<LocateResponse | null>('/public/locate', {
      params: { lat: position.coords.latitude, lng: position.coords.longitude },
    });
    if (!data) return { ok: false, reason: 'failed' };
    return {
      ok: true,
      precision: data.precision,
      location: {
        districtId: data.district.id,
        districtName: data.district.name,
        provinceName: data.district.provinceName,
        subdistrictId: data.subdistrict?.id ?? null,
        subdistrictName: data.subdistrict?.name ?? null,
        villageId: data.village?.id ?? null,
        villageName: data.village?.name ?? null,
        point: data.district.point,
      },
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function sameArea(a: CitizenLocation | null, b: CitizenLocation | null): boolean {
  return !!a && !!b && a.districtId === b.districtId && a.subdistrictId === b.subdistrictId && a.villageId === b.villageId;
}

export const DETECT_ERROR_TEXT: Record<Exclude<DetectResult, { ok: true }>['reason'], string> = {
  unsupported: 'Perangkat ini tidak mendukung deteksi lokasi. Silakan pilih wilayah secara manual.',
  denied: 'Izin lokasi ditolak. Izinkan lokasi di pengaturan browser, atau pilih wilayah secara manual.',
  unavailable: 'Lokasi belum bisa dibaca (sinyal GPS lemah). Coba lagi di tempat terbuka, atau pilih manual.',
  failed: 'Wilayah belum bisa ditentukan karena koneksi bermasalah. Coba lagi sebentar.',
};

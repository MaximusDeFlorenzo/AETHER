import type { IspuCategory } from '@/types/air-quality';

// P.14/2020 PM2.5 breakpoints, mirrored from the API so hourly bars can be
// coloured without a category per hour.
const ISPU_PM25: Array<[max: number, category: IspuCategory]> = [
  [15.5, 'baik'],
  [55.4, 'sedang'],
  [150.4, 'tidak_sehat'],
  [250.4, 'sangat_tidak_sehat'],
];

export function ispuFor(pm25: number): IspuCategory {
  return ISPU_PM25.find(([max]) => pm25 <= max)?.[1] ?? 'berbahaya';
}

export const ISPU_META: Record<
  IspuCategory,
  { label: string; solid: string; soft: string; text: string; advice: string }
> = {
  baik: {
    label: 'Baik',
    solid: 'bg-lv-normal',
    soft: 'bg-lv-normal-soft',
    text: 'text-lv-normal',
    advice: 'Udara bersih. Aman untuk beraktivitas di luar.',
  },
  sedang: {
    label: 'Sedang',
    solid: 'bg-lv-waspada',
    soft: 'bg-lv-waspada-soft',
    text: 'text-lv-waspada',
    advice: 'Masih dapat diterima. Warga yang sensitif (asma, lansia, anak) kurangi aktivitas berat di luar.',
  },
  tidak_sehat: {
    label: 'Tidak sehat',
    solid: 'bg-lv-siaga',
    soft: 'bg-lv-siaga-soft',
    text: 'text-lv-siaga',
    advice: 'Kurangi aktivitas di luar dan pakai masker N95/KN95 jika harus keluar.',
  },
  sangat_tidak_sehat: {
    label: 'Sangat tidak sehat',
    solid: 'bg-lv-awas',
    soft: 'bg-lv-awas-soft',
    text: 'text-lv-awas',
    advice: 'Tetap di dalam ruangan, tutup jendela dan pintu. Keluar hanya dengan masker N95.',
  },
  berbahaya: {
    label: 'Berbahaya',
    solid: 'bg-lv-awas',
    soft: 'bg-lv-awas-soft',
    text: 'text-lv-awas',
    advice: 'Hindari keluar rumah. Bila sesak napas atau pusing, segera ke fasilitas kesehatan.',
  },
};

export function formatTonnes(tonnes: number): string {
  return tonnes >= 1000
    ? `${(tonnes / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} ribu`
    : Math.round(tonnes).toLocaleString('id-ID');
}

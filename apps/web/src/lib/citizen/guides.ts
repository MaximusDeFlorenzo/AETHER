import type { HazardType } from '@/types/domain';
import type { PublicAlertHazard } from './types';

export type GuideKey = 'banjir' | 'longsor' | 'gempa' | 'tsunami' | 'erupsi' | 'asap';

export interface GuideNote {
  tone: 'info' | 'warning';
  title: string;
  text: string;
}

export interface Guide {
  key: GuideKey;
  label: string;
  /** Lower-case noun used inside sentences ("Sebelum banjir"). */
  noun: string;
  note?: GuideNote;
  before: string[];
  during: string[];
  after: string[];
}

// Plain-language guidance for citizens, written to be read in a hurry: short
// imperative sentences, one action each. Content follows the public
// preparedness guidance published by BNPB/BMKG/PVMBG; nothing here is
// location-specific, so it's safe to show nationwide and to cache offline.
export const GUIDES: Record<GuideKey, Guide> = {
  banjir: {
    key: 'banjir',
    label: 'Banjir',
    noun: 'banjir',
    before: [
      'Kenali jalan menuju tempat pengungsian atau tempat tinggi terdekat.',
      'Simpan KTP, KK, ijazah, dan obat dalam plastik kedap air.',
      'Siapkan tas siaga: senter, air minum, makanan ringan, obat, pakaian ganti, dan peluit.',
      'Bersihkan selokan dan saluran air di sekitar rumah.',
    ],
    during: [
      'Matikan listrik dari meteran sebelum air masuk rumah.',
      'Pindahkan barang berharga dan kendaraan ke tempat yang lebih tinggi.',
      'Jangan berjalan atau berkendara menembus arus. Air setinggi lutut sudah bisa menyeret orang.',
      'Jauhi selokan, gorong-gorong, dan kabel listrik yang terendam.',
      'Jika diminta mengungsi, segera pergi. Jangan menunggu air makin tinggi.',
    ],
    after: [
      'Kembali ke rumah hanya setelah dinyatakan aman oleh petugas.',
      'Bersihkan rumah memakai sepatu bot dan sarung tangan.',
      'Periksa instalasi listrik sebelum menyalakannya kembali.',
      'Rebus air sebelum diminum, dan buang makanan yang terendam.',
    ],
  },
  longsor: {
    key: 'longsor',
    label: 'Longsor',
    noun: 'longsor',
    before: [
      'Perhatikan tanda bahaya: retakan baru di tanah atau dinding, pintu yang tiba-tiba macet, air sumur yang mendadak keruh.',
      'Waspada jika hujan deras turun lebih dari 2 jam di daerah lereng.',
      'Kenali jalur menjauh dari lereng menuju tempat yang lebih aman.',
    ],
    during: [
      'Segera menjauh dari lereng. Berlari ke arah samping, bukan searah aliran longsor.',
      'Waspadai suara gemuruh, pohon berderak, atau batu yang berjatuhan.',
      'Jika terjebak, lindungi kepala dan tetap bersuara atau tiup peluit agar mudah ditemukan.',
    ],
    after: [
      'Jangan kembali sebelum dinyatakan aman oleh petugas. Longsor susulan sering terjadi.',
      'Jauhi area longsoran dan tebing yang retak.',
      'Laporkan retakan atau rembesan air baru kepada petugas.',
    ],
  },
  gempa: {
    key: 'gempa',
    label: 'Gempa',
    noun: 'gempa',
    note: {
      tone: 'warning',
      title: 'Gempa belum bisa diprediksi',
      text: 'Tidak ada yang bisa mengetahui kapan gempa terjadi, termasuk AETHER. Pesan berantai yang menyebut tanggal gempa adalah hoaks. Yang bisa diketahui adalah wilayah yang rawan, jadi persiapannya dilakukan sejak sekarang.',
    },
    before: [
      'Cek di peta apakah wilayah Anda termasuk rawan gempa.',
      'Ikat lemari, rak tinggi, dan tabung gas ke dinding.',
      'Siapkan tas siaga: senter, air, obat, dokumen penting, dan peluit.',
      'Sepakati titik kumpul keluarga di tempat terbuka.',
      'Tinggal di dekat pantai? Hafalkan jalan tercepat ke tempat tinggi.',
    ],
    during: [
      'Merunduk, lindungi kepala dan leher, lalu bertahan di bawah meja yang kuat.',
      'Jauhi kaca, jendela, dan lemari.',
      'Di luar rumah, jauhi gedung, tiang listrik, papan reklame, dan pohon.',
      'Di dekat pantai dan guncangan terasa kuat atau lama? Jangan tunggu sirene, segera ke tempat tinggi.',
    ],
    after: [
      'Keluar dengan tenang lewat jalur yang aman dan pakai alas kaki.',
      'Periksa kebocoran gas dan kabel listrik. Jangan menyalakan api.',
      'Waspadai gempa susulan dan jauhi bangunan yang retak.',
      'Ikuti informasi resmi BMKG, bukan pesan berantai.',
    ],
  },
  tsunami: {
    key: 'tsunami',
    label: 'Tsunami',
    noun: 'tsunami',
    note: {
      tone: 'warning',
      title: 'Guncangan kuat di pantai adalah peringatan pertama',
      text: 'Jangan menunggu sirene atau pesan. BMKG tetap mengeluarkan peringatan resmi, tetapi tsunami bisa tiba dalam hitungan menit setelah gempa.',
    },
    before: [
      'Kenali jalur dan tempat evakuasi tsunami di dekat Anda.',
      'Latih keluarga berjalan ke tempat tinggi dan catat berapa lama waktunya.',
      'Simpan tas siaga di dekat pintu keluar.',
    ],
    during: [
      'Air laut tiba-tiba surut atau terdengar gemuruh dari laut? Segera lari ke tempat tinggi.',
      'Menjauh dari pantai dan muara sungai.',
      'Jika bukit terlalu jauh, naik ke lantai atas bangunan beton yang kokoh.',
      'Jalan kaki atau naik motor. Mobil bisa terjebak macet.',
    ],
    after: [
      'Tetap di tempat tinggi sampai BMKG mencabut peringatan.',
      'Gelombang berikutnya bisa lebih besar dari yang pertama.',
      'Jauhi puing dan genangan yang mungkin teraliri listrik.',
    ],
  },
  erupsi: {
    key: 'erupsi',
    label: 'Erupsi',
    noun: 'erupsi',
    note: {
      tone: 'info',
      title: 'Gunung api biasanya memberi tanda',
      text: 'PVMBG memantau gunung api di Indonesia dan menetapkan 4 level: I Normal, II Waspada, III Siaga, dan IV Awas. Ikuti setiap kenaikan level dan radius bahaya yang diumumkan.',
    },
    before: [
      'Cari tahu status gunung api terdekat dan radius bahayanya.',
      'Kenali jalur pengungsian dan titik jemputan desa Anda.',
      'Siapkan masker, kacamata, dan penutup untuk sumur atau tampungan air.',
      'Level naik ke III Siaga? Siapkan tas dan kendaraan.',
    ],
    during: [
      'Level IV Awas atau diminta mengungsi: segera keluar dari radius bahaya dan ikuti arahan petugas.',
      'Jauhi sungai yang berhulu di gunung karena ada bahaya lahar.',
      'Saat hujan abu, pakai masker dan kacamata, lindungi kepala, dan tetap di dalam rumah.',
    ],
    after: [
      'Bersihkan abu di atap supaya tidak roboh. Selalu pakai masker.',
      'Jangan kembali sebelum level turun dan petugas mengizinkan.',
      'Waspadai lahar dingin saat hujan deras.',
    ],
  },
  asap: {
    key: 'asap',
    label: 'Asap & karhutla',
    noun: 'asap',
    note: {
      tone: 'info',
      title: 'Asap bisa terbawa angin sampai ratusan kilometer',
      text: 'Walaupun kebakarannya jauh, asap bisa sampai ke kota Anda jika angin bertiup dari arah kebakaran. Pantau kualitas udara dan arah angin setiap pagi.',
    },
    before: [
      'Siapkan masker N95 atau KN95 untuk setiap anggota keluarga.',
      'Pilih satu ruangan di rumah yang bisa ditutup rapat sebagai ruang bersih.',
      'Jangan membakar lahan atau sampah.',
    ],
    during: [
      'Kurangi kegiatan di luar rumah, terutama pagi hari saat asap paling pekat.',
      'Tutup jendela dan ventilasi.',
      'Anak, lansia, ibu hamil, dan penderita asma sebaiknya tetap di dalam ruangan.',
      'Minum air putih lebih banyak.',
    ],
    after: [
      'Periksakan diri ke puskesmas jika batuk, sesak napas, atau mata perih tidak membaik.',
      'Laporkan titik api yang Anda lihat kepada petugas.',
    ],
  },
};

export const GUIDE_ORDER: GuideKey[] = ['banjir', 'gempa', 'tsunami', 'erupsi', 'asap', 'longsor'];

export const MASK_GUIDE = {
  options: [
    {
      verdict: 'good' as const,
      name: 'N95 atau KN95',
      text: 'Menyaring partikel asap yang sangat halus (PM2.5). Paling disarankan.',
    },
    {
      verdict: 'partial' as const,
      name: 'Masker medis (bedah)',
      text: 'Sedikit membantu, tetapi sisi pinggirnya longgar sehingga asap tetap masuk.',
    },
    {
      verdict: 'bad' as const,
      name: 'Masker kain atau kain basah',
      text: 'Hampir tidak menyaring asap. Jangan diandalkan.',
    },
  ],
  steps: [
    'Cuci tangan, lalu pegang masker dari talinya.',
    'Pasang tali atas di belakang kepala dan tali bawah di belakang leher.',
    'Tekan penjepit logam dengan dua jari mengikuti bentuk hidung.',
    'Tes kebocoran: tarik napas. Masker harus sedikit mengempis. Jika udara bocor dari pinggir, betulkan posisinya.',
    'Ganti jika kotor, basah, rusak, atau terasa sulit bernapas.',
  ],
  caution: 'Bayi dan anak di bawah 2 tahun jangan dipakaikan masker. Lebih aman tetap di ruangan tertutup yang bersih.',
};

// Order matters: checklist ticks are stored by index, so new items go at
// the end to keep citizens' existing ticks on the right lines.
export const GENERAL_PREPAREDNESS = [
  'Siapkan tas siaga: senter, air minum, obat, dokumen penting, dan peluit.',
  'Simpan nomor darurat 112 dan nomor BPBD di HP Anda.',
  'Sepakati titik kumpul keluarga jika terjadi bencana.',
  'Simpan fotokopi KTP, KK, akta, dan ijazah dalam plastik kedap air, lalu foto juga dan simpan di HP.',
  'Kenali jalur evakuasi dan posko pengungsian terdekat dari rumah.',
  'Isi penuh powerbank dan siapkan radio atau senter bertenaga baterai.',
  'Siapkan uang tunai secukupnya, karena ATM dan pembayaran digital bisa mati saat bencana.',
  'Catat obat rutin dan kebutuhan khusus anggota keluarga: bayi, lansia, dan penyandang disabilitas.',
];

/** Shown first while a karhutla smoke advisory is active for the area. */
export const SMOKE_PREPAREDNESS = [
  'Siapkan masker N95 atau KF94 untuk setiap anggota keluarga.',
  'Pastikan obat asma, inhaler, atau obat jantung tersedia di rumah.',
  'Tutup celah pintu dan jendela dengan kain basah saat udara berbau asap.',
  'Perbanyak minum air putih dan pantau keluhan sesak, batuk, atau mata perih.',
];

export function guideKeyForHazardType(hazardType: HazardType): GuideKey {
  switch (hazardType) {
    case 'earthquake':
      return 'gempa';
    case 'flood':
      return 'banjir';
    case 'landslide':
      return 'longsor';
    case 'wildfire':
      return 'asap';
  }
}

export function guideKeyForAlertHazard(hazard: PublicAlertHazard): GuideKey | null {
  switch (hazard) {
    case 'flood':
      return 'banjir';
    case 'landslide':
      return 'longsor';
    case 'earthquake':
      return 'gempa';
    case 'tsunami':
      return 'tsunami';
    case 'volcano':
      return 'erupsi';
    case 'wildfire_smoke':
      return 'asap';
    default:
      return null;
  }
}

export function isGuideKey(value: string | null | undefined): value is GuideKey {
  return !!value && value in GUIDES;
}

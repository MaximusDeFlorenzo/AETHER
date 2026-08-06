// Shape of BMKG's public feeds:
// https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json (single latest event)
// https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json (list of recent events)
export interface BmkgGempa {
  Tanggal: string;
  Jam: string;
  DateTime: string;
  Coordinates: string;
  Lintang: string;
  Bujur: string;
  Magnitude: string;
  Kedalaman: string;
  Wilayah: string;
  Potensi?: string;
  Dirasakan?: string;
  Shakemap?: string;
}

export interface BmkgAutogempaResponse {
  Infogempa: { gempa: BmkgGempa };
}

export interface BmkgGempaterkiniResponse {
  Infogempa: { gempa: BmkgGempa[] };
}

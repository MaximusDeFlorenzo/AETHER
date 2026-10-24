import type { Metadata } from 'next';
import { CitizenShell } from '@/components/citizen/citizen-shell';

export const metadata: Metadata = {
  title: {
    default: 'AETHER Siaga · Info bencana untuk warga',
    template: '%s · AETHER Siaga',
  },
  description:
    'Status bahaya di wilayah Anda, kejadian bencana di Indonesia, panduan keselamatan, dan peringatan darurat. Tanpa daftar, tanpa login.',
  appleWebApp: {
    capable: true,
    title: 'AETHER Siaga',
    statusBarStyle: 'default',
  },
  openGraph: {
    locale: 'id_ID',
  },
};

// Public citizen portal — no auth anywhere in this route group. The analyst
// workspace (risk map, assessments, operations) lives behind AuthGuard in
// `(workspace)`; this group only ever shows plain-language summaries of the
// same data plus operator-issued alarms.
export default function CitizenLayout({ children }: { children: React.ReactNode }) {
  return <CitizenShell>{children}</CitizenShell>;
}

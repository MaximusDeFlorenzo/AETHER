'use client';

import { use } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { AlarmOverlay } from '@/components/citizen/alarm-overlay';
import { usePublicAlert } from '@/hooks/use-public-alerts';

// Landing screen for a push notification tap. Deliberately outside the
// `(warga)` shell — no header, no tab bar, nothing between the citizen and
// the instruction.
export default function AlarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isError } = usePublicAlert(id);

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-alarm text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4 font-citizen">
        <div className="grid max-w-md gap-3 text-center">
          <h1 className="text-2xl font-black">Peringatan tidak bisa dimuat</h1>
          <p className="text-muted-foreground">
            Periksa sinyal Anda. Jika Anda dalam bahaya, segera ikuti arahan petugas atau hubungi 112.
          </p>
          <Link href="/" className="mx-auto rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground">
            Ke beranda
          </Link>
        </div>
      </div>
    );
  }

  return <AlarmOverlay alert={data} variant="page" onDismiss={() => window.location.assign('/')} />;
}

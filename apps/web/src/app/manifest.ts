import type { MetadataRoute } from 'next';

// Web app manifest — what lets citizens "Tambahkan ke Layar Utama". On
// iPhone/iPad that step is required before Safari will deliver web push
// alarms at all (see lib/citizen/push.ts's 'ios-needs-install').
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AETHER Siaga · Info bencana untuk warga',
    short_name: 'AETHER Siaga',
    description: 'Status bahaya di wilayah Anda, panduan keselamatan, dan peringatan darurat.',
    lang: 'id',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Same navy as the opening animation the installed app plays on every
    // launch, so Android's (unremovable) icon splash fades straight into it.
    background_color: '#081b3a',
    theme_color: '#081b3a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

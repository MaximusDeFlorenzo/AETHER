'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// react-leaflet touches `window` at import time — client-only, same as
// components/map/map-loader.tsx.
export const KarhutlaMap = dynamic(() => import('./karhutla-map').then((mod) => mod.KarhutlaMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// react-leaflet touches `window` at import time — client-only, same as
// components/karhutla/karhutla-map-loader.tsx.
export const RainfallOutlookMap = dynamic(
  () => import('./rainfall-outlook-map').then((mod) => mod.RainfallOutlookMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-lg" />,
  },
);

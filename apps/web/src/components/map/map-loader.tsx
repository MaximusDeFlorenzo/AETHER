'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// react-leaflet touches `window` at import time, so it must never run during
// SSR/static generation — loaded client-side only via next/dynamic. Same
// discipline as ORION's map/map-loader.tsx.
export const HazardMap = dynamic(
  () => import('./hazard-map').then((mod) => mod.HazardMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-lg" />,
  },
);

'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// react-leaflet touches `window` at import time — client-only, same as
// components/rainfall/rainfall-outlook-map-loader.tsx.
export const EarthquakeMap = dynamic(() => import('./earthquake-map').then((mod) => mod.EarthquakeMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

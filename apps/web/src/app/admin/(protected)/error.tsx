'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Failed to load admin page</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Something went wrong loading this data. Try again, or reload the page if the problem
              persists.
            </p>
          </div>
          <Button onClick={reset} variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

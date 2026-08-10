'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useFieldReport, useLinkFieldReport } from '@/hooks/use-field-reports';
import { CV_DETECTION_TYPE_LABELS } from '@/lib/labels';
import { formatHazardEventLocation } from '@/lib/hazard-severity';

// Review detail for a single CV detection — shows the submitted image with
// its bounding boxes and lets a reviewer promote it to a real hazard event
// (docs/DATABASE_SCHEMA.md §22's nullable `hazard_event_id`, the workflow
// it was designed for).
export default function FieldReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: report, isLoading } = useFieldReport(id);
  const linkMutation = useLinkFieldReport();
  const [hazardEventId, setHazardEventId] = useState('');

  const handleLink = () => {
    if (!hazardEventId.trim()) {
      toast.error('Enter a hazard event ID to link');
      return;
    }
    linkMutation.mutate(
      { id, hazardEventId: hazardEventId.trim() },
      {
        onSuccess: () => toast.success('Linked to hazard event'),
        onError: () => toast.error('Failed to link — check the hazard event ID is correct'),
      },
    );
  };

  if (isLoading || !report) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Button variant="ghost" size="sm" render={<Link href="/field-reports" />}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Field Reports
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {CV_DETECTION_TYPE_LABELS[report.detectionType]} detection
        </h1>
        <Badge variant="secondary">{Math.round(report.confidenceScore * 100)}% confidence</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.imageUrl}
            alt={`${report.detectionType} detection`}
            className="w-full rounded-t-lg object-cover"
          />
          <div className="space-y-1 p-4 text-sm text-muted-foreground">
            <p>Submitted {format(new Date(report.createdAt), 'dd MMM yyyy HH:mm')}</p>
            <p>{report.boundingBoxes.length} bounding box(es) detected</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Hazard event
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.hazardEvent ? (
            <div className="flex items-center justify-between">
              <p className="text-sm">
                Linked to{' '}
                <Link href={`/hazards/${report.hazardEvent.id}`} className="font-medium hover:underline">
                  {formatHazardEventLocation(report.hazardEvent)}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Not yet linked to a hazard event. If this detection corroborates a known event,
                enter its ID below to promote it.
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="hazardEventId">Hazard event ID</Label>
                  <Input
                    id="hazardEventId"
                    value={hazardEventId}
                    onChange={(e) => setHazardEventId(e.target.value)}
                    placeholder="UUID"
                  />
                </div>
                <Button onClick={handleLink} disabled={linkMutation.isPending}>
                  {linkMutation.isPending ? 'Linking…' : 'Link'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

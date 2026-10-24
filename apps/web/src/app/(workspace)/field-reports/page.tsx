'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Camera, ImageOff, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFieldReports } from '@/hooks/use-field-reports';
import { CV_DETECTION_TYPE_LABELS } from '@/lib/labels';
import { PageHeader } from '@/components/shared/page-header';

// Review queue for citizen/field-reporter Computer Vision submissions
// (docs/ARCHITECTURE.md §5) — the application-layer counterpart to the
// `cv_detections` schema. Any authenticated role can view this page; the
// underlying GET /field-reports is admin/agency_operator/analyst-only on
// apps/api, so a field_reporter-only account will see a 403 error state
// here (expected — they submit reports, they don't review them).
export default function FieldReportsPage() {
  const { data, isLoading, isError } = useFieldReports({ limit: 50 });
  const reports = data?.data ?? [];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={Camera}
        title="Field Reports"
        description="Computer Vision Engine detections from citizen/field-reporter photo submissions."
        actions={
          <Button render={<Link href="/field-reports/new" />}>
            <Plus className="mr-2 h-4 w-4" /> Submit report
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detections</CardTitle>
        </CardHeader>
        <CardContent>
          {isError && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You don&apos;t have access to the review queue — field reporters submit reports but
              don&apos;t review them.
            </p>
          )}
          {!isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Linked event</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading &&
                  reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <Link href={`/field-reports/${report.id}`} className="hover:underline">
                          {CV_DETECTION_TYPE_LABELS[report.detectionType]}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {Math.round(report.confidenceScore * 100)}%
                      </TableCell>
                      <TableCell className="text-sm">
                        {report.hazardEvent ? (
                          <Badge variant="secondary">Linked</Badge>
                        ) : (
                          <span className="text-muted-foreground">Unlinked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(report.createdAt), 'dd MMM yyyy HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && reports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      <ImageOff className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
                      No field reports submitted yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

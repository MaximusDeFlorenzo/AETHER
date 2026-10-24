'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ClipboardCheck, Copy, Images, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { useGroundReports } from '@/hooks/use-ground-reports';
import {
  GROUND_REPORT_STATUS_LABELS,
  OBSERVATION_TYPE_LABELS,
  STATUS_BADGE_VARIANT,
} from '@/lib/ground-reports';
import { useAuthStore } from '@/stores/auth-store';
import type { GroundObservationType, GroundReportStatus } from '@/types/ground-reports';

// AETHER Ground Intelligence — community observations and their review
// queue. Field reporters see only their own reports (enforced by the API);
// analysts/operators/admins see every report and review them.
export default function GroundReportsPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isReviewer = role === 'analyst' || role === 'agency_operator' || role === 'admin';
  const [status, setStatus] = useState<GroundReportStatus | undefined>(undefined);
  const [observationType, setObservationType] = useState<GroundObservationType | undefined>(
    undefined,
  );
  const { data, isLoading, isError } = useGroundReports({ status, observationType, limit: 50 });
  const reports = data?.data ?? [];
  const columns = isReviewer ? 7 : 5;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Ground Reports"
        description={
          isReviewer
            ? 'Community flood, fire and smoke observations awaiting or past review. Review status is not event verification and never makes a report training data.'
            : 'Your flood, fire and smoke observations and their review status.'
        }
        actions={
          <Button render={<Link href="/ground-reports/new" />}>
            <Plus className="mr-2 h-4 w-4" /> New report
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">{isReviewer ? 'Review queue' : 'My reports'}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select
              value={status ?? 'all'}
              onValueChange={(v) =>
                setStatus(v === 'all' ? undefined : (v as GroundReportStatus))
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(GROUND_REPORT_STATUS_LABELS) as GroundReportStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {GROUND_REPORT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={observationType ?? 'all'}
              onValueChange={(v) =>
                setObservationType(v === 'all' ? undefined : (v as GroundObservationType))
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.keys(OBSERVATION_TYPE_LABELS) as GroundObservationType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {OBSERVATION_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ground reports could not be loaded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Observation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Nearest district</TableHead>
                  <TableHead>Observed</TableHead>
                  <TableHead>Photos</TableHead>
                  {isReviewer && <TableHead>Reporter</TableHead>}
                  {isReviewer && <TableHead>Flags</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={columns}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading &&
                  reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <Link href={`/ground-reports/${report.id}`} className="hover:underline">
                          {OBSERVATION_TYPE_LABELS[report.observationType]}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE_VARIANT[report.status]}>
                          {GROUND_REPORT_STATUS_LABELS[report.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {report.nearestDistrict?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(report.observedAt), 'dd MMM yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-sm">{report.evidenceCount}</TableCell>
                      {isReviewer && (
                        <TableCell className="text-sm">{report.reporter?.fullName ?? '—'}</TableCell>
                      )}
                      {isReviewer && (
                        <TableCell>
                          {report.duplicateOfId && (
                            <Badge variant="outline">
                              <Copy /> Possible resend
                            </Badge>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                {!isLoading && reports.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={columns}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      <Images className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
                      No ground reports match these filters.
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

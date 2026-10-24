'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Copy, ImagePlus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  groundReportErrorMessage,
  useAddGroundReportEvidence,
  useGroundReport,
  useTransitionGroundReport,
} from '@/hooks/use-ground-reports';
import {
  availableReviewActions,
  GROUND_REPORT_STATUS_LABELS,
  OBSERVATION_TYPE_LABELS,
  SEVERITY_LABELS,
  STATUS_BADGE_VARIANT,
  type ReviewAction,
} from '@/lib/ground-reports';
import { useAuthStore } from '@/stores/auth-store';
import type { GroundReportDetail } from '@/types/ground-reports';

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function fmt(value: string) {
  return format(new Date(value), 'dd MMM yyyy HH:mm');
}

export default function GroundReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuthStore((state) => state.user);
  const { data: report, isLoading, isError } = useGroundReport(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !report) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </div>
    );
  }

  // The API returns a reporter-only view (no `reporter`) solely for the
  // report's own author.
  const isOwner = report.reporter === undefined || report.reporter.id === user?.id;
  const reviewActions = availableReviewActions(report.status, user?.role);
  const canAddEvidence =
    isOwner && (report.status === 'submitted' || report.status === 'needs_more_evidence');
  const pendingRequest =
    report.status === 'needs_more_evidence'
      ? [...report.statusHistory].reverse().find((h) => h.toStatus === 'needs_more_evidence')
      : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" render={<Link href="/ground-reports" />}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Ground reports
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {OBSERVATION_TYPE_LABELS[report.observationType]}
          </h1>
          <Badge variant={STATUS_BADGE_VARIANT[report.status]}>
            {GROUND_REPORT_STATUS_LABELS[report.status]}
          </Badge>
        </div>
      </div>

      {pendingRequest && isOwner && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>A reviewer asked for more evidence</AlertTitle>
          <AlertDescription>{pendingRequest.reason}</AlertDescription>
        </Alert>
      )}

      {report.duplicateOfId && (
        <Alert>
          <Copy />
          <AlertTitle>Possible resend</AlertTitle>
          <AlertDescription>
            Same reporter, same type, within 50 m and 30 minutes of{' '}
            <Link href={`/ground-reports/${report.duplicateOfId}`} className="underline">
              an earlier report
            </Link>
            . Count it once.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Observation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{report.description}</p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Observed</dt>
              <dd>{fmt(report.observedAt)}</dd>
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{fmt(report.submittedAt)}</dd>
              <dt className="text-muted-foreground">Location</dt>
              <dd className="font-mono text-xs">
                {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
              </dd>
              <dt className="text-muted-foreground">Nearest district</dt>
              <dd>
                {report.nearestDistrict?.name ?? '—'}
                <span className="block text-xs text-muted-foreground">
                  Nearest district reference point, not a boundary match
                </span>
              </dd>
              {report.waterDepthCm != null && (
                <>
                  <dt className="text-muted-foreground">Water depth</dt>
                  <dd>{report.waterDepthCm} cm (reporter estimate)</dd>
                </>
              )}
              {report.reporterSeverity && (
                <>
                  <dt className="text-muted-foreground">Reporter severity</dt>
                  <dd>{SEVERITY_LABELS[report.reporterSeverity]}</dd>
                </>
              )}
              {report.reporter && (
                <>
                  <dt className="text-muted-foreground">Reporter</dt>
                  <dd>{report.reporter.fullName ?? report.reporter.id}</dd>
                </>
              )}
              {report.trainingEligible !== undefined && (
                <>
                  <dt className="text-muted-foreground">Training data</dt>
                  <dd>{report.trainingEligible ? 'Eligible' : 'Not eligible'}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {report.statusHistory.map((h, i) => (
                <li key={h.id ?? i} className="border-l-2 border-border pl-3">
                  <div className="font-medium">
                    {h.fromStatus ? GROUND_REPORT_STATUS_LABELS[h.fromStatus] + ' → ' : ''}
                    {GROUND_REPORT_STATUS_LABELS[h.toStatus]}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmt(h.createdAt)}
                    {h.actorUserId && ` · ${h.actorUserId.slice(0, 8)}`}
                  </div>
                  {h.reason && <p className="mt-1">{h.reason}</p>}
                  {h.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">Internal note: {h.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <EvidenceCard report={report} />

      {canAddEvidence && <AddEvidenceCard reportId={report.id} />}

      {reviewActions.length > 0 && <ReviewCard reportId={report.id} actions={reviewActions} />}
    </div>
  );
}

function EvidenceCard({ report }: { report: GroundReportDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Photos ({report.evidence.length})</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {report.evidence.map((e) => (
          <figure key={e.id} className="space-y-2">
            <a href={e.imageUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={e.imageUrl}
                alt="Report evidence"
                className="aspect-video w-full rounded-lg border border-border/60 object-cover"
              />
            </a>
            <figcaption className="space-y-1 text-xs text-muted-foreground">
              <div>Uploaded {fmt(e.createdAt)}</div>
              {e.exif !== undefined && (
                <div>
                  Camera time:{' '}
                  {e.exif?.dateTimeOriginal
                    ? `${e.exif.dateTimeOriginal}${e.exif.offsetTimeOriginal ? ` ${e.exif.offsetTimeOriginal}` : ' (no zone)'}`
                    : 'none'}
                  {' · '}Camera GPS:{' '}
                  {e.exif?.gps
                    ? `${e.exif.gps.latitude.toFixed(5)}, ${e.exif.gps.longitude.toFixed(5)}`
                    : 'none'}
                </div>
              )}
              {e.cvHint !== undefined && (
                <div>
                  CV hint (not evidence):{' '}
                  {e.cvHint
                    ? e.cvHint.detections.length
                      ? e.cvHint.detections
                          .map((d) => `${d.detectionType} ${Math.round(d.confidenceScore * 100)}%`)
                          .join(', ')
                      : 'nothing detected'
                    : 'unavailable'}
                </div>
              )}
              {e.duplicateOfEvidenceId && (
                <Badge variant="destructive">Same file was uploaded before</Badge>
              )}
            </figcaption>
          </figure>
        ))}
      </CardContent>
    </Card>
  );
}

function AddEvidenceCard({ reportId }: { reportId: string }) {
  const addEvidence = useAddGroundReportEvidence(reportId);
  const [files, setFiles] = useState<File[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add photos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <Button
          disabled={files.length === 0 || addEvidence.isPending}
          onClick={() =>
            addEvidence.mutate(files, {
              onSuccess: () => {
                toast.success('Photos added');
                setFiles([]);
              },
              onError: (error) =>
                toast.error(groundReportErrorMessage(error, 'Could not add photos')),
            })
          }
        >
          <ImagePlus className="mr-2 h-4 w-4" />
          {addEvidence.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </CardContent>
    </Card>
  );
}

function ReviewCard({ reportId, actions }: { reportId: string; actions: ReviewAction[] }) {
  const transition = useTransitionGroundReport(reportId);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const run = (action: ReviewAction) => {
    if (action.reasonRequired && !reason.trim()) {
      toast.error(`"${action.label}" needs a reason`);
      return;
    }
    transition.mutate(
      { to: action.to, reason: reason.trim() || undefined, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Report: ${GROUND_REPORT_STATUS_LABELS[action.to]}`);
          setReason('');
          setNotes('');
        },
        onError: (error) =>
          toast.error(groundReportErrorMessage(error, 'Status change failed')),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Verifying confirms this observation only. It does not create a hazard event, send alerts
          or make the report training data.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason (shown to the reporter)</Label>
          <textarea
            id="reason"
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Internal notes (reviewers only)</Label>
          <textarea
            id="notes"
            rows={2}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.to}
              variant={action.destructive ? 'destructive' : 'secondary'}
              disabled={transition.isPending}
              onClick={() => run(action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

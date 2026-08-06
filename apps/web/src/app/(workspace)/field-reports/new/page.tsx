'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSubmitFieldReport } from '@/hooks/use-field-reports';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import type { HazardType } from '@/types/domain';

// Citizen/field-reporter photo submission -> Computer Vision Engine, per
// docs/ARCHITECTURE.md §5. Any authenticated role can view this page (the
// (workspace) group's usual posture), but only field_reporter/admin/
// agency_operator can actually submit — apps/api enforces that; a 403 here
// surfaces as the mutation's error state.
export default function NewFieldReportPage() {
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hazardTypeHint, setHazardTypeHint] = useState<HazardType | undefined>(undefined);
  const [notes, setNotes] = useState('');

  const submit = useSubmitFieldReport();

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return selected ? URL.createObjectURL(selected) : null;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      toast.error('Please choose a photo to submit');
      return;
    }
    submit.mutate(
      { image: file, hazardTypeHint, notes: notes || undefined },
      {
        onSuccess: (result) => {
          if (result.detections.length === 0) {
            toast.success('Photo submitted — no hazards detected in this image');
          } else {
            toast.success(`Photo submitted — ${result.detections.length} detection(s) found`);
          }
          router.push('/field-reports');
        },
        onError: () => toast.error('Submission failed — check your role has field-report access'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Camera className="h-5 w-5" /> Submit Field Report
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a photo from the field — the Computer Vision Engine screens it for flood, smoke,
          fire, and infrastructure-damage signals for reviewer follow-up.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photo</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="image">Image (JPEG, PNG, or WebP — max 10MB)</Label>
              <input
                id="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Selected field report"
                  className="mt-2 max-h-64 w-full rounded-lg border border-border/60 object-cover"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Suspected hazard type (optional)</Label>
              <Select
                value={hazardTypeHint ?? 'none'}
                onValueChange={(v) => setHazardTypeHint(v === 'none' ? undefined : (v as HazardType))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not sure" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not sure — check everything</SelectItem>
                  {(Object.keys(HAZARD_TYPE_LABELS) as HazardType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {HAZARD_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Narrows which detectors run — e.g. &quot;Wildfire&quot; only checks for fire/smoke.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Anything else worth noting about this location or scene"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submit.isPending}>
                <Upload className="mr-2 h-4 w-4" />
                {submit.isPending ? 'Submitting…' : 'Submit report'}
              </Button>
              <Button type="button" variant="ghost" render={<Link href="/field-reports" />}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

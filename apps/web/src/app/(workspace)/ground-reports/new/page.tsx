'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardCheck, LocateFixed, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { groundReportErrorMessage, useSubmitGroundReport } from '@/hooks/use-ground-reports';
import { OBSERVATION_TYPE_LABELS, SEVERITY_LABELS } from '@/lib/ground-reports';
import type { GroundObservationType, GroundReportSeverity } from '@/types/ground-reports';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** `datetime-local` value for "now" in the browser's own zone. */
function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Photos have their EXIF (including GPS) stripped by the API before storage;
// the location below is what reviewers see, and it is never shown publicly.
export default function NewGroundReportPage() {
  const router = useRouter();
  const submit = useSubmitGroundReport();
  const [observationType, setObservationType] = useState<GroundObservationType>('floodwater');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [observedAt, setObservedAt] = useState(localNow);
  const [description, setDescription] = useState('');
  const [waterDepthCm, setWaterDepthCm] = useState('');
  const [severity, setSeverity] = useState<GroundReportSeverity | undefined>(undefined);
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const handleImages = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length > MAX_IMAGES) {
      toast.error(`At most ${MAX_IMAGES} photos per upload`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than 10 MB`);
      return;
    }
    setImages(files);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  };

  const fillMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('This browser cannot read your location — enter it manually');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        toast.error('Location unavailable — enter it manually');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!latitude || !longitude || Number.isNaN(lat) || Number.isNaN(lon)) {
      toast.error('Enter the location where you saw it');
      return;
    }
    if (images.length === 0) {
      toast.error('Add at least one photo');
      return;
    }
    const observed = new Date(observedAt);
    if (Number.isNaN(observed.getTime())) {
      toast.error('Enter when you saw it');
      return;
    }
    submit.mutate(
      {
        observationType,
        latitude: lat,
        longitude: lon,
        observedAt: observed.toISOString(),
        description: description.trim(),
        waterDepthCm:
          observationType === 'floodwater' && waterDepthCm !== ''
            ? Number(waterDepthCm)
            : undefined,
        reporterSeverity: severity,
        images,
      },
      {
        onSuccess: (report) => {
          toast.success('Report submitted for review');
          router.push(`/ground-reports/${report.id}`);
        },
        onError: (error) =>
          toast.error(groundReportErrorMessage(error, 'Submission failed — please try again')),
      },
    );
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck className="h-5 w-5" /> New Ground Report
        </h1>
        <p className="text-sm text-muted-foreground">
          Report floodwater, fire or smoke you have seen yourself. A reviewer checks every report
          before it is used anywhere.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Observation</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>What did you see?</Label>
              <Select
                value={observationType}
                onValueChange={(v) => setObservationType(v as GroundObservationType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OBSERVATION_TYPE_LABELS) as GroundObservationType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {OBSERVATION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {observationType === 'smoke' && (
                <p className="text-xs text-muted-foreground">
                  Report smoke where you are, even if you cannot see the fire.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Location</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={fillMyLocation}
                  disabled={locating}
                >
                  <LocateFixed className="mr-1 h-4 w-4" />
                  {locating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  inputMode="decimal"
                  placeholder="Latitude, e.g. -6.200000"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  aria-label="Latitude"
                />
                <Input
                  inputMode="decimal"
                  placeholder="Longitude, e.g. 106.816666"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  aria-label="Longitude"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="observedAt">When did you see it?</Label>
              <Input
                id="observedAt"
                type="datetime-local"
                value={observedAt}
                max={localNow()}
                onChange={(e) => setObservedAt(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minLength={10}
                maxLength={2000}
                rows={4}
                required
                className={TEXTAREA_CLASS}
                placeholder="What you saw, where exactly, and whether it is getting worse"
              />
            </div>

            {observationType === 'floodwater' && (
              <div className="space-y-1.5">
                <Label htmlFor="depth">Estimated water depth in cm (optional)</Label>
                <Input
                  id="depth"
                  type="number"
                  min={0}
                  max={1000}
                  value={waterDepthCm}
                  onChange={(e) => setWaterDepthCm(e.target.value)}
                  placeholder="Ankle ≈ 10, knee ≈ 50, waist ≈ 100"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>How serious does it look? (optional)</Label>
              <Select
                value={severity ?? 'none'}
                onValueChange={(v) =>
                  setSeverity(v === 'none' ? undefined : (v as GroundReportSeverity))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not sure" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not sure</SelectItem>
                  {(Object.keys(SEVERITY_LABELS) as GroundReportSeverity[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SEVERITY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="images">Photos (1–{MAX_IMAGES}, JPEG/PNG/WebP, max 10 MB each)</Label>
              <input
                id="images"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
                onChange={(e) => handleImages(e.target.files)}
              />
              {previews.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {previews.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt={`Selected photo ${i + 1}`}
                      className="aspect-square w-full rounded-lg border border-border/60 object-cover"
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submit.isPending}>
                <Upload className="mr-2 h-4 w-4" />
                {submit.isPending ? 'Submitting…' : 'Submit report'}
              </Button>
              <Button type="button" variant="ghost" render={<Link href="/ground-reports" />}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

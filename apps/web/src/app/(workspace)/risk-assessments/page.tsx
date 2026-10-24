'use client';

import { Gauge } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { RiskLevelBadge } from '@/components/shared/risk-level-badge';
import { SortableTableHead } from '@/components/shared/sortable-table-head';
import { TablePagination } from '@/components/shared/table-pagination';
import { useRiskAssessments } from '@/hooks/use-risk-assessments';
import { usePagination } from '@/hooks/use-pagination';
import { useSortableData } from '@/hooks/use-sortable-data';
import { RISK_ASSESSMENT_STATUS_LABELS } from '@/lib/labels';
import { formatHazardEventLocation } from '@/lib/hazard-severity';
import type { HazardType, RiskAssessment } from '@/types/domain';
import { PageHeader } from '@/components/shared/page-header';

type RiskAssessmentSortKey = 'district' | 'riskScore' | 'population' | 'confidence';

function getSortValue(ra: RiskAssessment, key: RiskAssessmentSortKey) {
  switch (key) {
    case 'district':
      return ra.district.name;
    case 'riskScore':
      return ra.riskScore;
    case 'population':
      return ra.estimatedAffectedPopulation;
    case 'confidence':
      return ra.confidenceScore;
  }
}

const HAZARD_TYPE_OPTIONS: { value: HazardType | 'all'; label: string }[] = [
  { value: 'all', label: 'All hazard types' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'landslide', label: 'Landslide' },
];

// Analyst/agency-only workspace page — generalizes ORION's predictions/page.tsx.
// Adds the "baseline" toggle: standing risk assessments computed without an
// active hazard event (hazardEventId IS NULL), the prediction/prevention
// pipeline ORION never had (docs/ARCHITECTURE.md §2.2).
export default function RiskAssessmentsPage() {
  const [hazardType, setHazardType] = useState<HazardType | 'all'>('all');
  const [baselineOnly, setBaselineOnly] = useState(false);

  const { data, isLoading } = useRiskAssessments({
    hazardType: hazardType === 'all' ? undefined : hazardType,
    baseline: baselineOnly || undefined,
    limit: 100,
  });

  const assessments = data?.data ?? [];

  const { sorted, sortKey, sortDirection, toggleSort } = useSortableData<
    RiskAssessment,
    RiskAssessmentSortKey
  >(assessments, getSortValue, { key: 'riskScore', direction: 'desc' });
  const { pageData, page, pageCount, setPage, canPrev, canNext, total } = usePagination(sorted, 10);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <PageHeader icon={Gauge} title="Risk Assessments"
        description="AI-computed risk score and exposure level per district, per hazard type."
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56 space-y-1.5">
          <Label>Hazard type</Label>
          <Select value={hazardType} onValueChange={(v) => setHazardType((v as HazardType | 'all') ?? 'all')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HAZARD_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <Switch checked={baselineOnly} onCheckedChange={setBaselineOnly} />
          Standing/baseline assessments only
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assessments{baselineOnly ? ' — Baseline (no active event)' : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  sortKey="district"
                  label="District"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <TableHead>Hazard type</TableHead>
                <TableHead>Source event</TableHead>
                <SortableTableHead
                  sortKey="riskScore"
                  label="Risk score"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <TableHead>Exposure</TableHead>
                <SortableTableHead
                  sortKey="population"
                  label="Est. affected"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <SortableTableHead
                  sortKey="confidence"
                  label="Confidence"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading &&
                pageData.map((ra) => (
                  <TableRow key={ra.id}>
                    <TableCell>{ra.district.name}</TableCell>
                    <TableCell>
                      <HazardTypeBadge hazardType={ra.hazardType} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ra.hazardEvent ? formatHazardEventLocation(ra.hazardEvent) : 'Baseline (no event)'}
                    </TableCell>
                    <TableCell>{ra.riskScore?.toFixed(1) ?? '—'}</TableCell>
                    <TableCell>{ra.exposureLevel ? <RiskLevelBadge level={ra.exposureLevel} /> : '—'}</TableCell>
                    <TableCell>{ra.estimatedAffectedPopulation?.toLocaleString() ?? '—'}</TableCell>
                    <TableCell>
                      {ra.confidenceScore != null ? `${Math.round(ra.confidenceScore * 100)}%` : '—'}
                      {ra.status !== 'completed' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({RISK_ASSESSMENT_STATUS_LABELS[ra.status]})
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No risk assessments yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            pageCount={pageCount}
            total={total}
            canPrev={canPrev}
            canNext={canNext}
            onPageChange={setPage}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            Last updated {format(new Date(), 'dd MMM yyyy HH:mm')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

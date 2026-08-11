'use client';

import { Building2, Home, Package, Truck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HazardTypeBadge } from '@/components/shared/hazard-type-badge';
import { useResourceOptimizationPlans, useShelters } from '@/hooks/use-resource-plans';
import type { ResourceOptimizationPlan } from '@/types/domain';

const PLAN_STATUS_VARIANT = {
  draft: 'outline',
  approved: 'default',
  executed: 'secondary',
} as const;

// planDetails is loosely-typed JSON (see ResourceOptimizationPlanDetails'
// comment in types/domain.ts) — every read here defaults to 0 rather than
// trusting the shape.
function planVolunteers(plan: ResourceOptimizationPlan): number {
  return plan.planDetails.volunteers?.total ?? 0;
}
function planAmbulances(plan: ResourceOptimizationPlan): number {
  return plan.planDetails.ambulance?.required ?? 0;
}
function planVehicles(plan: ResourceOptimizationPlan): number {
  const v = plan.planDetails.vehicles;
  if (!v) return 0;
  return (v.rescueVehicles ?? 0) + (v.logisticsTrucks ?? 0) + (v.excavators ?? 0) + (v.heavyEquipment ?? 0);
}
function planShelters(plan: ResourceOptimizationPlan): number {
  return plan.planDetails.evacuationShelters ?? 0;
}
function planLogisticsAidTons(plan: ResourceOptimizationPlan): number {
  return plan.planDetails.logisticsAidTons ?? 0;
}

// New for AETHER — evolves ORION's hospitals + resource_estimates concept
// into resource_optimization_plans + shelters (docs/MIGRATION_FROM_ORION.md).
// Analyst/agency-only workspace page.
export default function ResourcePlanningPage() {
  const { data: plansPage, isLoading: plansLoading } = useResourceOptimizationPlans({ limit: 50 });
  const { data: shelters = [], isLoading: sheltersLoading } = useShelters();

  const plans = plansPage?.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resource Planning</h1>
        <p className="text-sm text-muted-foreground">
          AI-optimized personnel, logistics, and shelter allocation per district.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" /> Resource Optimization Plans
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>District</TableHead>
                <TableHead>Hazard type</TableHead>
                <TableHead>Personnel</TableHead>
                <TableHead>Volunteers</TableHead>
                <TableHead>Ambulances</TableHead>
                <TableHead>Vehicles</TableHead>
                <TableHead>Shelters</TableHead>
                <TableHead>Logistics (t)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plansLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!plansLoading &&
                plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>{plan.district.name}</TableCell>
                    <TableCell>
                      {plan.hazardEvent ? (
                        <HazardTypeBadge hazardType={plan.hazardEvent.hazardType} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{(plan.estimatedPersonnelNeeded ?? 0).toLocaleString()}</TableCell>
                    <TableCell>{planVolunteers(plan).toLocaleString()}</TableCell>
                    <TableCell>{planAmbulances(plan).toLocaleString()}</TableCell>
                    <TableCell>{planVehicles(plan).toLocaleString()}</TableCell>
                    <TableCell>{planShelters(plan).toLocaleString()}</TableCell>
                    <TableCell>{planLogisticsAidTons(plan).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={PLAN_STATUS_VARIANT[plan.status]} className="capitalize">
                        {plan.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              {!plansLoading && plans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                    No resource optimization plans yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="h-4 w-4" /> Shelters
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sheltersLoading && <Skeleton className="h-32 w-full" />}
          {!sheltersLoading && shelters.length === 0 && (
            <p className="text-sm text-muted-foreground">No registered shelters yet.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shelters.map((shelter) => {
              const occupancyPct =
                shelter.currentOccupancy != null && shelter.capacity > 0
                  ? Math.round((shelter.currentOccupancy / shelter.capacity) * 100)
                  : null;
              return (
                <div key={shelter.id} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {shelter.name}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{shelter.district.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    {shelter.currentOccupancy?.toLocaleString() ?? '—'} / {shelter.capacity.toLocaleString()}
                    {occupancyPct != null && (
                      <span className="text-muted-foreground">({occupancyPct}%)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Package className="h-4 w-4 shrink-0" />
          Plans are computed by apps/ai-engine&apos;s resource_optimization router whenever a
          decision recommendation&apos;s priority score crosses the risk-notification threshold,
          then persisted by apps/api as a draft — same heuristic-first, swappable-model
          discipline as ORION&apos;s resource_estimator.py (docs/MIGRATION_FROM_ORION.md).
        </CardContent>
      </Card>
    </div>
  );
}

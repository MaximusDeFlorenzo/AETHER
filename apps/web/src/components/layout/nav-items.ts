import {
  Activity,
  BarChart3,
  Boxes,
  Camera,
  Gauge,
  Leaf,
  Map as MapIcon,
  ShieldAlert,
  User,
  Users,
} from 'lucide-react';

// Public surface nav (docs/ARCHITECTURE.md's `(public)` route group) — no
// auth required. Generalizes ORION's earthquake-only NAV_ITEMS to AETHER's
// multi-hazard route list.
export const PUBLIC_NAV_ITEMS = [
  { href: '/risk-map', label: 'Risk Map', icon: MapIcon },
  { href: '/hazards', label: 'Hazard Events', icon: Activity },
  { href: '/sustainability', label: 'Sustainability', icon: Leaf },
] as const;

// Analyst/agency workspace — new in AETHER (ORION's whole command-center was
// public; these routes sit behind AuthGuard per docs/MIGRATION_FROM_ORION.md).
export const WORKSPACE_NAV_ITEMS = [
  { href: '/risk-assessments', label: 'Risk Assessments', icon: Gauge },
  { href: '/decision-intelligence', label: 'Decision Intelligence', icon: ShieldAlert },
  { href: '/resource-planning', label: 'Resource Planning', icon: Boxes },
  { href: '/field-reports', label: 'Field Reports', icon: Camera },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
] as const;

// Single source of truth shared by the desktop admin sidebar and the mobile
// admin nav sheet, so the two never drift.
export const ADMIN_NAV_ITEMS = [
  { href: '/admin/settings', label: 'Settings', icon: Users },
  { href: '/admin/profile', label: 'Profile', icon: User },
] as const;

export const ALL_SHELL_NAV_ITEMS = [...PUBLIC_NAV_ITEMS, ...WORKSPACE_NAV_ITEMS] as const;

import {
  Activity,
  BarChart3,
  Boxes,
  BrainCircuit,
  Camera,
  Gauge,
  Leaf,
  Map as MapIcon,
  ShieldAlert,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavLink[];
}

// Top-level nav bar links, shown directly (no dropdown) — generalizes
// ORION's earthquake-only NAV_ITEMS to AETHER's multi-hazard route list.
// No auth required for these routes.
export const PRIMARY_NAV_LINKS: NavLink[] = [
  { href: '/risk-map', label: 'Risk Map', icon: MapIcon },
  { href: '/hazards', label: 'Hazards', icon: Activity },
];

// Analyst/agency workspace — new in AETHER (ORION's whole command-center was
// public; these routes sit behind AuthGuard per docs/MIGRATION_FROM_ORION.md).
// Grouped under nav-bar dropdowns rather than a flat list so the top nav
// stays a single row at desktop widths.
export const INTELLIGENCE_NAV_GROUP: NavGroup = {
  label: 'Intelligence',
  icon: BrainCircuit,
  items: [
    { href: '/risk-assessments', label: 'Risk Assessments', icon: Gauge },
    { href: '/decision-intelligence', label: 'Decision Intelligence', icon: ShieldAlert },
  ],
};

export const OPERATIONS_NAV_GROUP: NavGroup = {
  label: 'Operations',
  icon: Boxes,
  items: [
    { href: '/resource-planning', label: 'Resource Planning', icon: Boxes },
    { href: '/field-reports', label: 'Field Reports', icon: Camera },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  ],
};

export const NAV_GROUPS: NavGroup[] = [INTELLIGENCE_NAV_GROUP, OPERATIONS_NAV_GROUP];

export const SUSTAINABILITY_NAV_LINK: NavLink = {
  href: '/sustainability',
  label: 'Sustainability',
  icon: Leaf,
};

// Single source of truth shared by the desktop admin sidebar and the mobile
// admin nav sheet, so the two never drift.
export const ADMIN_NAV_ITEMS: NavLink[] = [
  { href: '/admin/settings', label: 'Settings', icon: Users },
  { href: '/admin/profile', label: 'Profile', icon: User },
] as const;

// Flat list of every workspace/public route — used by the mobile nav sheet,
// which renders groups as collapsible sections but still needs the full set
// for active-route highlighting.
export const ALL_SHELL_NAV_ITEMS: NavLink[] = [
  ...PRIMARY_NAV_LINKS,
  ...INTELLIGENCE_NAV_GROUP.items,
  ...OPERATIONS_NAV_GROUP.items,
  SUSTAINABILITY_NAV_LINK,
];

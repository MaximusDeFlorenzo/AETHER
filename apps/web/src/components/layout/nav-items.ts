import {
  Activity,
  AudioWaveform,
  BarChart3,
  Boxes,
  BrainCircuit,
  Camera,
  ClipboardCheck,
  CloudRain,
  Flame,
  Gauge,
  Layers,
  Leaf,
  Map as MapIcon,
  ShieldAlert,
  Siren,
  Tent,
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
// These live in `(workspace)` behind AuthGuard: the analytic risk map and
// raw hazard feed are for analysts/operators. Citizens get the plain-
// language portal in `(warga)` instead.
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
    { href: '/karhutla', label: 'Karhutla Forecast', icon: Flame },
    { href: '/rainfall', label: 'Rainfall Outlook', icon: CloudRain },
    { href: '/earthquake', label: 'Earthquake Monitor', icon: AudioWaveform },
  ],
};

export const OPERATIONS_NAV_GROUP: NavGroup = {
  label: 'Operations',
  icon: Boxes,
  items: [
    { href: '/resource-planning', label: 'Resource Planning', icon: Boxes },
    { href: '/ground-reports', label: 'Ground Reports', icon: ClipboardCheck },
    { href: '/field-reports', label: 'Field Reports', icon: Camera },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/regions', label: 'Regions', icon: Layers },
    { href: '/public-alerts', label: 'Citizen Alarms', icon: Siren },
    { href: '/shelters', label: 'Posko & Titik Kumpul', icon: Tent },
  ],
};

export const NAV_GROUPS: NavGroup[] = [INTELLIGENCE_NAV_GROUP, OPERATIONS_NAV_GROUP];

// Staff are redirected away from `/` to the workspace, so the citizen
// portal is reached with ?lihat=warga (see components/citizen/citizen-shell).
export const CITIZEN_PORTAL_LINK: NavLink = {
  href: '/?lihat=warga',
  label: 'Portal Warga',
  icon: Users,
};

export const SUSTAINABILITY_NAV_LINK: NavLink = {
  href: '/sustainability',
  label: 'Sustainability',
  icon: Leaf,
};

export interface NavSection {
  label?: string;
  items: NavLink[];
}

// Every workspace route, grouped as the sidebar and the mobile sheet show
// them. All items stay visible (no dropdowns) so pages such as Karhutla
// Forecast are not hidden one click deep.
export const SHELL_NAV_SECTIONS: NavSection[] = [
  { label: 'Monitor', items: PRIMARY_NAV_LINKS },
  { label: INTELLIGENCE_NAV_GROUP.label, items: INTELLIGENCE_NAV_GROUP.items },
  { label: OPERATIONS_NAV_GROUP.label, items: OPERATIONS_NAV_GROUP.items },
  { label: 'Impact', items: [SUSTAINABILITY_NAV_LINK] },
];

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

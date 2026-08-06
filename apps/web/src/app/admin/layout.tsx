import type { Metadata } from 'next';

// Isolated admin area (login + protected pages) — never indexed or followed,
// unlike the public risk-map/hazards/sustainability surface.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import { Activity, CloudFog, Flame, Mountain, TriangleAlert, Waves, type LucideProps } from 'lucide-react';
import type { GuideKey } from '@/lib/citizen/guides';
import type { PublicAlertHazard } from '@/lib/citizen/types';
import type { HazardType } from '@/types/domain';

// lucide has no volcano glyph — drawn to match its 24px/2px-stroke style.
export function VolcanoIcon({ className, strokeWidth = 2, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M2 21l6-10h2l1.5 2L13 11h3l6 10z" />
      <path d="M10 7c0-2 1-3 2.5-3S15 3 15 1.5M12.5 8.5c.5-1.5 2-2 3.5-2" />
    </svg>
  );
}

type IconComponent = (props: LucideProps) => React.ReactNode;

const BY_HAZARD_TYPE: Record<HazardType, IconComponent> = {
  earthquake: Activity,
  flood: Waves,
  landslide: Mountain,
  wildfire: Flame,
};

const BY_ALERT_HAZARD: Record<PublicAlertHazard, IconComponent> = {
  flood: Waves,
  landslide: Mountain,
  earthquake: Activity,
  tsunami: Waves,
  volcano: VolcanoIcon,
  wildfire_smoke: CloudFog,
  other: TriangleAlert,
};

const BY_GUIDE: Record<GuideKey, IconComponent> = {
  banjir: Waves,
  longsor: Mountain,
  gempa: Activity,
  tsunami: Waves,
  erupsi: VolcanoIcon,
  asap: CloudFog,
};

export function HazardIcon({
  hazardType,
  alertHazard,
  guide,
  ...props
}: LucideProps & { hazardType?: HazardType | null; alertHazard?: PublicAlertHazard | null; guide?: GuideKey | null }) {
  const Icon =
    (hazardType && BY_HAZARD_TYPE[hazardType]) ||
    (alertHazard && BY_ALERT_HAZARD[alertHazard]) ||
    (guide && BY_GUIDE[guide]) ||
    TriangleAlert;
  return <Icon {...props} />;
}

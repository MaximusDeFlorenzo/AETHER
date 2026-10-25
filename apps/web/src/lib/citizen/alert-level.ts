import type { PublicAlertLevel } from './types';

/** Colours of the full-screen alarm per BNPB level. Fixed hexes, not theme
 * tokens: the dark theme lightens --lv-* for text on navy, which would put
 * white alarm text on a pale orange/yellow. */
export const ALERT_LEVEL_TONE: Record<
  PublicAlertLevel,
  { label: string; bg: string; text: string; soft: string; hex: string }
> = {
  awas: { label: 'AWAS', bg: 'bg-alarm', text: 'text-alarm', soft: 'bg-[#fde3e3]', hex: '#c1121f' },
  siaga: { label: 'SIAGA', bg: 'bg-[#c2570c]', text: 'text-[#c2570c]', soft: 'bg-[#fde8d8]', hex: '#c2570c' },
  waspada: { label: 'WASPADA', bg: 'bg-[#8f6800]', text: 'text-[#8f6800]', soft: 'bg-[#fbf0cc]', hex: '#8f6800' },
};

export const ALERT_LEVELS: PublicAlertLevel[] = ['waspada', 'siaga', 'awas'];

export const alertLevelOf = (alert: { level?: PublicAlertLevel }): PublicAlertLevel => alert.level ?? 'awas';

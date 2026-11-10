import type { CSSProperties } from 'react';
const safeColor = (value: string | undefined, fallback: string) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function ink(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  // Black/white selection guarantees at least WCAG AA contrast for normal text.
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
export function brandStyle(
  color: string,
  secondaryColor?: string,
  accentColor?: string,
): CSSProperties {
  const primary = safeColor(color, '#1c5947');
  const secondary = safeColor(secondaryColor, '#253b57');
  const accent = safeColor(accentColor, '#ddedbb');
  return {
    '--brand': primary,
    '--brand-button': primary,
    '--brand-ink': ink(primary),
    '--brand-secondary': secondary,
    '--brand-secondary-ink': ink(secondary),
    '--brand-accent': accent,
    '--brand-accent-ink': ink(accent),
    '--pine': 'color-mix(in srgb, var(--brand-secondary) 28%, #111111)',
    '--theme-text': 'var(--pine)',
    '--theme-muted': 'color-mix(in srgb, var(--brand-secondary) 20%, #545454)',
    '--muted': 'var(--theme-muted)',
    '--theme-border': 'color-mix(in srgb, var(--brand-secondary) 17%, #ffffff)',
    '--line': 'var(--theme-border)',
    '--theme-paper': 'color-mix(in srgb, var(--brand-secondary) 3%, #ffffff)',
    '--paper': 'var(--theme-paper)',
    '--theme-soft': 'color-mix(in srgb, var(--brand-secondary) 7%, #ffffff)',
    '--theme-accent-soft': 'color-mix(in srgb, var(--brand-accent) 24%, #ffffff)',
    '--lime': 'var(--theme-accent-soft)',
    '--theme-stage': 'color-mix(in srgb, var(--brand-secondary) 20%, #111111)',
    '--theme-stage-panel': 'color-mix(in srgb, var(--brand-secondary) 28%, #202020)',
    '--theme-stage-line': 'color-mix(in srgb, var(--brand-secondary) 25%, #606060)',
  } as CSSProperties;
}

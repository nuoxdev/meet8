import type { CSSProperties } from 'react';
export function brandStyle(color: string): CSSProperties {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1c5947';
  const rgb = [1, 3, 5]
    .map((i) => parseInt(safe.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return {
    '--brand': safe,
    '--brand-button': safe,
    '--brand-ink': luminance > 0.179 ? '#101a14' : '#ffffff',
  } as CSSProperties;
}

export function goalColorFromKey(key: string): string {
  // Stable per-goal hue so the same goal keeps the same color across renders.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} var(--calendar-proposed-saturation) var(--calendar-proposed-lightness))`;
}

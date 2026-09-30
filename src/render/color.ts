export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

const HEAT_STOPS: [number, RGB][] = [
  [0, [48, 10, 6]],
  [0.25, [150, 30, 10]],
  [0.5, [232, 74, 18]],
  [0.75, [255, 160, 52]],
  [1, [255, 244, 214]],
];

/** Black-body-ish ramp used for everything hot. */
export function heat(t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i];
    const [p0, c0] = HEAT_STOPS[i - 1];
    if (x <= p1) return mix(c0, c1, (x - p0) / (p1 - p0));
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

export const WHITE: RGB = [255, 255, 255];
export const GOLD: RGB = [255, 214, 120];

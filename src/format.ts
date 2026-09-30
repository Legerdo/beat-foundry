const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** 1234 -> "1.23K", 12 -> "12", 3.4 -> "3.4" */
export function fmtShort(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return `-${fmtShort(-n)}`;
  if (n < 1000) return n < 10 ? (Math.floor(n * 10) / 10).toString() : Math.floor(n).toString();
  const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
  const v = n / Math.pow(1000, e);
  const s = v >= 100 ? Math.floor(v).toString() : v >= 10 ? (Math.floor(v * 10) / 10).toFixed(1) : (Math.floor(v * 100) / 100).toFixed(2);
  return `${s}${SUFFIX[e]}`;
}

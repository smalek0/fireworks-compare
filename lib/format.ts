export function formatMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTokensPerSec(v: number | undefined): string {
  if (!v || !Number.isFinite(v)) return "—";
  return `${Math.round(v)}`;
}

export function formatUSD(v: number | undefined, digits = 4): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  if (v === 0) return "$0";
  if (v < 0.0001) return `<$0.0001`;
  return `$${v.toFixed(digits)}`;
}

export function formatMoneyShort(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export function formatCalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

export function sliderToCalls(v: number): number {
  return Math.round(10 ** (3 + v / 25));
}

export function callsToSlider(calls: number): number {
  return (Math.log10(calls) - 3) * 25;
}

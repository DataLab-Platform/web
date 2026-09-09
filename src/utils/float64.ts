export function nextFiniteFloat64(
  value: number,
  direction: -1 | 1,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return direction * Number.MIN_VALUE;
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const bits = buffer.getBigUint64(0);
  buffer.setBigUint64(0, bits + (value > 0 === direction > 0 ? 1n : -1n));
  const next = buffer.getFloat64(0);
  return Number.isFinite(next) ? next : null;
}

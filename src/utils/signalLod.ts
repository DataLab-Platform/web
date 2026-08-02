/**
 * Level-of-detail (LOD) helpers for signal rendering.
 *
 * Dense signals are reduced for display only; the original samples remain
 * available for computations, editing, and exact rendering after zooming.
 */

export interface SignalLodOptions {
  /** Useful plot width in CSS pixels. */
  width: number;
  /** Visible X-axis range. Omit for the complete signal extent. */
  xRange?: readonly [number, number] | null;
  /** Return exact samples at or below this density. */
  exactSamplesPerPixel?: number;
}

export interface SignalLodResult {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  exact: boolean;
  sourcePointCount: number;
}

function lowerBound(values: ArrayLike<number>, length: number, target: number) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: ArrayLike<number>, length: number, target: number) {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function copyWindow(
  values: ArrayLike<number>,
  start: number,
  end: number,
): number[] {
  const output = new Array<number>(end - start);
  for (let index = start; index < end; index += 1) {
    output[index - start] = values[index];
  }
  return output;
}

/**
 * Reduce a monotonic-X signal to a screen-sized min/max envelope.
 *
 * Every occupied screen bucket emits its Y extrema in source order. The
 * visible window's first and last finite samples are retained, and NaN runs
 * remain explicit separators so Plotly never joins disconnected segments.
 */
export function reduceSignalForPlot(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: SignalLodOptions,
): SignalLodResult {
  const length = Math.min(x.length, y.length);
  if (length === 0) {
    return { x: [], y: [], exact: true, sourcePointCount: 0 };
  }

  const width = Math.max(1, Math.floor(options.width));
  let rangeStart = x[0];
  let rangeEnd = x[length - 1];
  if (
    options.xRange &&
    Number.isFinite(options.xRange[0]) &&
    Number.isFinite(options.xRange[1])
  ) {
    rangeStart = Math.min(options.xRange[0], options.xRange[1]);
    rangeEnd = Math.max(options.xRange[0], options.xRange[1]);
  }

  let start = lowerBound(x, length, rangeStart);
  let end = upperBound(x, length, rangeEnd);
  // Keep one neighbour on either side so Plotly can clip line segments at
  // the viewport boundary instead of starting at the first in-range sample.
  if (start > 0) start -= 1;
  if (end < length) end += 1;
  if (start >= end) {
    return { x: [], y: [], exact: true, sourcePointCount: 0 };
  }

  const sourcePointCount = end - start;
  const exactSamplesPerPixel = options.exactSamplesPerPixel ?? 4;
  if (sourcePointCount <= width * exactSamplesPerPixel) {
    if (start === 0 && end === length) {
      return { x, y, exact: true, sourcePointCount };
    }
    return {
      x: copyWindow(x, start, end),
      y: copyWindow(y, start, end),
      exact: true,
      sourcePointCount,
    };
  }

  let firstFinite = start;
  while (
    firstFinite < end &&
    (!Number.isFinite(x[firstFinite]) || !Number.isFinite(y[firstFinite]))
  ) {
    firstFinite += 1;
  }
  let lastFinite = end - 1;
  while (
    lastFinite >= start &&
    (!Number.isFinite(x[lastFinite]) || !Number.isFinite(y[lastFinite]))
  ) {
    lastFinite -= 1;
  }

  const outputX: number[] = [];
  const outputY: number[] = [];
  if (firstFinite > lastFinite) {
    return {
      x: [NaN],
      y: [NaN],
      exact: false,
      sourcePointCount,
    };
  }

  const span = rangeEnd - rangeStart;
  const bucketFor = (value: number) => {
    if (!(span > 0)) {
      return Math.min(
        width - 1,
        Math.floor(
          ((value - x[start]) / Math.max(1, sourcePointCount - 1)) * width,
        ),
      );
    }
    const normalized = (value - rangeStart) / span;
    return Math.max(0, Math.min(width - 1, Math.floor(normalized * width)));
  };

  const buckets = new Array<
    { minimumIndex: number; maximumIndex: number } | undefined
  >(width);

  for (let index = start; index < end; index += 1) {
    const xValue = x[index];
    const yValue = y[index];
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
    const bucket = bucketFor(xValue);
    const extrema = buckets[bucket];
    if (!extrema) {
      buckets[bucket] = { minimumIndex: index, maximumIndex: index };
    } else {
      if (yValue < y[extrema.minimumIndex]) extrema.minimumIndex = index;
      if (yValue > y[extrema.maximumIndex]) extrema.maximumIndex = index;
    }
  }

  const selected = new Set<number>([firstFinite, lastFinite]);
  for (const extrema of buckets) {
    if (!extrema) continue;
    selected.add(extrema.minimumIndex);
    selected.add(extrema.maximumIndex);
  }
  const indices = [...selected].sort((left, right) => left - right);
  let previousIndex = -1;
  for (const index of indices) {
    if (previousIndex >= 0) {
      let hasGap = false;
      for (
        let sourceIndex = previousIndex + 1;
        sourceIndex < index;
        sourceIndex += 1
      ) {
        if (
          !Number.isFinite(x[sourceIndex]) ||
          !Number.isFinite(y[sourceIndex])
        ) {
          hasGap = true;
          break;
        }
      }
      if (hasGap) {
        outputX.push(x[previousIndex]);
        outputY.push(NaN);
      }
    }
    outputX.push(x[index]);
    outputY.push(y[index]);
    previousIndex = index;
  }

  return {
    x: outputX,
    y: outputY,
    exact: false,
    sourcePointCount,
  };
}
